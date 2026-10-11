"""Authenticated generation endpoints; orchestration belongs to GenerationCoordinator."""
import uuid
from typing import Optional
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.auth import get_current_user
from server.database import get_db
from server.generation.contracts import GenerationParameters, TaskContext
from server.generation.coordinator import GenerationCoordinator
from server.generation.tasks import TaskBusyError, TaskConflictError, TaskOwnershipError
from server.models import ChatMessage, ChatSession, GeneratedImage, User
from server.schemas import GenerateMediaRequest, GenerateMediaResponse
from utils.media_file_references import user_owns_media_path
from utils.reference_video import motion_video_owner

router = APIRouter()


def get_generation_coordinator(service: AIDrawService = Depends(get_ai_draw_service)) -> GenerationCoordinator:
    return service.generation


def _validate_reference_ownership(
    value: Optional[str],
    user_id: int,
    db: Session,
    label: str,
) -> None:
    """Reject local upload URLs that are not recorded as belonging to this user."""
    if not value:
        return

    reference = value.strip()
    if reference.startswith('data:'):
        return

    parsed = urlparse(reference)
    path = unquote(parsed.path) if parsed.scheme in ('http', 'https') else reference
    if not (path.startswith('/uploads/') or path.startswith('uploads/')):
        return

    if not user_owns_media_path(db, user_id, path):
        raise HTTPException(status_code=403, detail=f'{label}不属于当前用户')


def _validate_motion_video_ownership(value: Optional[str], user_id: int, label: str = '动作视频') -> None:
    """Motion videos accept only the stored upload form, whose path already names the owner."""
    if value is None:
        return
    owner = motion_video_owner(value)
    if owner is None:
        raise HTTPException(status_code=422, detail=f'{label}地址无效，请重新上传')
    if owner != user_id:
        raise HTTPException(status_code=403, detail=f'{label}不属于当前用户')



@router.post("/generate", response_model=GenerateMediaResponse)
async def generate_media(
    request: GenerateMediaRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    generation: GenerationCoordinator = Depends(get_generation_coordinator),
    db: Session = Depends(get_db),
) -> GenerateMediaResponse:
    if bool(request.message_id) != bool(request.session_id):
        raise HTTPException(status_code=400, detail="message_id 和 session_id 必须同时提供")
    if request.append_results and not request.message_id:
        raise HTTPException(status_code=400, detail="追加结果需要指定已有对话")

    if request.message_id and request.session_id:
        session = db.query(ChatSession).filter(
            ChatSession.session_id == request.session_id,
            ChatSession.user_id == current_user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        if not request.message_id.endswith('-reply'):
            raise HTTPException(status_code=400, detail="助手消息 ID 格式无效")

        source_message_id = request.message_id.removesuffix('-reply')
        source_message = db.query(ChatMessage).filter(
            ChatMessage.message_id == source_message_id,
            ChatMessage.session_id == request.session_id,
            ChatMessage.user_id == current_user.id,
            ChatMessage.type == 'user',
        ).first()
        if not source_message:
            raise HTTPException(status_code=400, detail="找不到对应的用户消息")

    # 归一化参考图槽位：新列表字段优先，否则由 legacy 三字段构建
    reference_images = (
        list(request.reference_images) if request.reference_images is not None
        else [request.reference_image, request.reference_image_2, request.reference_image_3]
    )
    for index, value in enumerate(reference_images):
        _validate_reference_ownership(value, current_user.id, db, f'参考图 {index + 1}')
    _validate_reference_ownership(request.reference_image_end, current_user.id, db, '尾帧参考图')

    for index, value in enumerate(request.motion_reference_images or []):
        _validate_reference_ownership(value, current_user.id, db, f'动作参考 {index + 1}')
    _validate_motion_video_ownership(request.motion_reference_video, current_user.id)

    parameters = GenerationParameters(**request.model_dump(exclude={"message_id", "session_id", "task_id", "append_results"}))
    result_offset = db.query(GeneratedImage).filter(GeneratedImage.message_id == request.message_id).count() if request.append_results else 0
    context = TaskContext(
        user_id=current_user.id, task_id=request.task_id or uuid.uuid4().hex,
        workflow=request.workflow, session_id=request.session_id, message_id=request.message_id,
        append_results=request.append_results, result_offset=result_offset,
    )
    try:
        task = generation.reserve(context, parameters)
    except TaskBusyError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    try:
        background_tasks.add_task(generation.run, task, parameters)
    except BaseException:
        generation.abort_submission(task)
        raise
    return GenerateMediaResponse(count=0, images=[], task_id=context.task_id)


@router.get("/last-task")
async def get_last_task(
    current_user: User = Depends(get_current_user),
    generation: GenerationCoordinator = Depends(get_generation_coordinator),
) -> dict:
    return {"last_task": generation.tasks.last_task(current_user.id)}


@router.get("/stop")
@router.post("/stop")
async def stop_generation(
    task_id: Optional[str] = Query(default=None, min_length=1, max_length=64),
    current_user: User = Depends(get_current_user),
    generation: GenerationCoordinator = Depends(get_generation_coordinator),
) -> dict:
    try:
        stopped = await generation.stop(current_user.id, task_id)
    except TaskOwnershipError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except TaskConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"success": True, "message": "已停止生成" if stopped else "当前没有生成任务"}
