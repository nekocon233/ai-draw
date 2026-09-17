"""
聊天会话管理 API
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import List, Optional

from server.database import get_db
from server.models import ChatSession, ChatMessage, GeneratedImage, User
from server.auth import get_current_user
from utils.file_storage import get_file_storage
from utils.media_file_references import delete_unreferenced_media
from utils.session_title import get_session_title_generator

router = APIRouter(prefix="/chat")

# ============ Pydantic 模型 ============

class CreateSessionRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=50)
    title: Optional[str] = "新对话"

class UpdateSessionTitleRequest(BaseModel):
    title: str

class UpdateSessionPinnedRequest(BaseModel):
    is_pinned: bool

class UpdateMessageRequest(BaseModel):
    """更新用户消息内容请求（用于编辑后重新生成）"""
    content: Optional[str] = None
    reference_image: Optional[str] = None
    reference_image_2: Optional[str] = None
    reference_image_3: Optional[str] = None
    reference_image_end: Optional[str] = None
    prompt_end: Optional[str] = None

class SessionResponse(BaseModel):
    id: str
    title: str
    is_pinned: bool
    created_at: int  # Unix 时间戳（毫秒）
    updated_at: int  # Unix 时间戳（毫秒）
    message_count: int
    config: Optional[dict] = None  # 会话配置

class SessionConfigRequest(BaseModel):
    """更新会话配置请求"""
    workflow: Optional[str] = None
    prompt: Optional[str] = None
    lora_prompt: Optional[str] = None
    strength: Optional[float] = None
    count: Optional[int] = None
    images_per_row: Optional[int] = None
    reference_image: Optional[str] = None
    reference_image_2: Optional[str] = None
    reference_image_3: Optional[str] = None
    prompt_end: Optional[str] = None
    reference_image_end: Optional[str] = None
    is_loop: Optional[bool] = None
    start_frame_count: Optional[int] = None
    end_frame_count: Optional[int] = None
    frame_rate: Optional[float] = None
    frame_count: Optional[int] = None
    workflow_options: Optional[dict] = None

# ============ 会话管理 API ============


def _stored_media_paths(messages) -> list[str]:
    paths = [image.file_path for message in messages for image in list(message.images)]
    for message in messages:
        paths.extend(filter(None, (
            message.reference_image,
            message.reference_image_2,
            message.reference_image_3,
            message.reference_image_end,
        )))
    return paths


def _serialize_message(message: ChatMessage) -> dict:
    payload = {
        'id': message.message_id,
        'type': message.type,
        'content': message.content,
        'timestamp': int(message.created_at.timestamp() * 1000),
    }
    if message.type == 'user' and message.workflow:
        params = {
            'workflow': message.workflow,
            'count': message.count,
            'loraPrompt': message.lora_prompt,
        }
        optional_params = {
            'strength': message.strength,
            'referenceImage': message.reference_image,
            'referenceImage2': message.reference_image_2,
            'referenceImage3': message.reference_image_3,
            'referenceImageEnd': message.reference_image_end,
            'promptEnd': message.prompt_end,
            'frameRate': message.frame_rate,
            'startFrameCount': message.start_frame_count,
            'endFrameCount': message.end_frame_count,
            'frameCount': message.frame_count,
            'workflowOptions': message.workflow_options,
        }
        params.update({key: value for key, value in optional_params.items() if value is not None})
        payload['params'] = params
    elif message.type == 'assistant':
        file_storage = get_file_storage()

        def to_url(path: str) -> str:
            if path.startswith(('data:', '/')):
                return path
            return file_storage.get_file_url(path)

        payload['images'] = [
            to_url(image.file_path)
            for image in sorted(
                message.images,
                key=lambda item: (item.image_index is None, item.image_index or 0),
            )
        ]
    return payload

@router.get("/sessions", response_model=List[SessionResponse])
def get_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户的所有会话列表"""
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.is_pinned.desc(), ChatSession.updated_at.desc()).all()
    
    result = []
    for session in sessions:
        # 统计该会话的消息数量
        message_count = db.query(func.count(ChatMessage.id)).filter(
            ChatMessage.session_id == session.session_id
        ).scalar() or 0
        
        result.append(SessionResponse(
            id=session.session_id,
            title=session.title,
            is_pinned=session.is_pinned,
            created_at=int(session.created_at.timestamp() * 1000),
            updated_at=int(session.updated_at.timestamp() * 1000),
            message_count=message_count
        ))
    
    return result

@router.post("/sessions")
def create_session(
    request: CreateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建新会话"""
    # 检查会话ID是否已存在
    existing = db.query(ChatSession).filter(
        ChatSession.session_id == request.session_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="会话ID已存在"
        )
    
    # 创建会话（从 workflow_metadata 读取默认配置）
    from utils.config_loader import get_config
    cfg = get_config()
    
    session = ChatSession(
        session_id=request.session_id,
        user_id=current_user.id,
        title=request.title or "新对话",
        config_workflow="t2i",
        config_prompt=None,
        config_lora_prompt=cfg.workflow_defaults.get_workflow_parameter_default('t2i', 'lora_prompt'),
        config_strength=cfg.workflow_defaults.get_workflow_parameter_default('t2i', 'strength'),
        config_count=cfg.workflow_defaults.get_workflow_parameter_default('t2i', 'count'),
        config_images_per_row=cfg.workflow_defaults.col_count
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    
    print(f"[Session] 用户 {current_user.username} 创建会话: {request.session_id}")
    return {
        "session_id": session.session_id,
        "title": session.title,
        "is_pinned": session.is_pinned,
        "created_at": int(session.created_at.timestamp() * 1000),
        "updated_at": int(session.updated_at.timestamp() * 1000)
    }

@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除会话及其所有消息"""
    # 查找会话
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )
    
    # 删除会话（级联删除所有消息和图片）
    file_paths = _stored_media_paths(session.messages)
    file_paths.extend(filter(None, (
        session.config_reference_image,
        session.config_reference_image_2,
        session.config_reference_image_3,
        session.config_reference_image_end,
    )))
    db.delete(session)
    db.commit()
    delete_unreferenced_media(db, file_paths)
    
    print(f"[Session] 用户 {current_user.username} 删除会话: {session_id}")
    return {"message": "会话删除成功"}

@router.put("/sessions/{session_id}")
def update_session_title(
    session_id: str,
    request: UpdateSessionTitleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新会话标题"""
    # 查找会话
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )
    
    # 更新标题
    session.title = request.title
    session.updated_at = datetime.now()
    db.commit()
    
    print(f"[Session] 用户 {current_user.username} 更新会话标题: {session_id} -> {request.title}")
    return {"message": "会话标题更新成功"}

@router.patch("/sessions/{session_id}/pin")
def update_session_pin(
    session_id: str,
    request: UpdateSessionPinnedRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """置顶或取消置顶会话。"""
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )

    session.is_pinned = request.is_pinned
    db.commit()
    return {"is_pinned": session.is_pinned}

@router.post("/sessions/{session_id}/summarize-title")
def summarize_session_title(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """根据会话中的用户消息生成并保存简短标题。"""
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )

    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.user_id == current_user.id,
        ChatMessage.content.isnot(None)
    ).order_by(ChatMessage.created_at.asc()).all()
    content = "\n".join(
        f"{'用户' if message.type == 'user' else '助手'}：{message.content.strip()}"
        for message in messages
        if message.content and message.content.strip()
    )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="会话中没有可总结的内容"
        )

    title = get_session_title_generator().generate(content)
    session.title = title
    db.commit()
    return {"title": title}

@router.put("/sessions/{session_id}/config")
def update_session_config(
    session_id: str,
    request: SessionConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新会话配置"""
    # 查找会话
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )
    
    # 更新配置字段（使用 model_dump 检查字段是否显式设置）
    update_data = request.model_dump(exclude_unset=True)
    stale_reference_paths = []
    reference_fields = {
        'reference_image': 'config_reference_image',
        'reference_image_2': 'config_reference_image_2',
        'reference_image_3': 'config_reference_image_3',
        'reference_image_end': 'config_reference_image_end',
    }
    for request_field, model_field in reference_fields.items():
        if request_field in update_data:
            old_value = getattr(session, model_field)
            if old_value and old_value != update_data[request_field]:
                stale_reference_paths.append(old_value)
    
    if 'workflow' in update_data:
        session.config_workflow = update_data['workflow']
    if 'prompt' in update_data:
        session.config_prompt = update_data['prompt']
    if 'lora_prompt' in update_data:
        session.config_lora_prompt = update_data['lora_prompt']
    if 'strength' in update_data:
        session.config_strength = update_data['strength']
    if 'count' in update_data:
        session.config_count = update_data['count']
    if 'images_per_row' in update_data:
        session.config_images_per_row = update_data['images_per_row']
    if 'reference_image' in update_data:
        session.config_reference_image = update_data['reference_image']
    if 'reference_image_2' in update_data:
        session.config_reference_image_2 = update_data['reference_image_2']
    if 'reference_image_3' in update_data:
        session.config_reference_image_3 = update_data['reference_image_3']
    if 'prompt_end' in update_data:
        session.config_prompt_end = update_data['prompt_end']
    if 'reference_image_end' in update_data:
        session.config_reference_image_end = update_data['reference_image_end']
    if 'is_loop' in update_data:
        session.config_is_loop = update_data['is_loop']
    if 'start_frame_count' in update_data:
        session.config_start_frame_count = update_data['start_frame_count']
    if 'end_frame_count' in update_data:
        session.config_end_frame_count = update_data['end_frame_count']
    if 'frame_rate' in update_data:
        session.config_frame_rate = update_data['frame_rate']
    if 'frame_count' in update_data:
        session.config_frame_count = update_data['frame_count']
    if 'workflow_options' in update_data:
        session.config_workflow_options = update_data['workflow_options']
    
    session.updated_at = datetime.now()
    db.commit()
    delete_unreferenced_media(db, stale_reference_paths)
    
    print(f"[Session] 用户 {current_user.username} 更新会话配置: {session_id}")
    return {"message": "会话配置更新成功"}

@router.get("/sessions/{session_id}/config")
def get_session_config(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取会话配置"""
    # 查找会话
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )
    
    return {
        "workflow": session.config_workflow,
        "prompt": session.config_prompt,
        "lora_prompt": session.config_lora_prompt,
        "strength": session.config_strength,
        "count": session.config_count,
        "images_per_row": session.config_images_per_row,
        "reference_image": session.config_reference_image,
        "reference_image_2": session.config_reference_image_2,
        "reference_image_3": session.config_reference_image_3,
        "prompt_end": session.config_prompt_end,
        "reference_image_end": session.config_reference_image_end,
        "is_loop": session.config_is_loop,
        "start_frame_count": session.config_start_frame_count,
        "end_frame_count": session.config_end_frame_count,
        "frame_rate": session.config_frame_rate,
        "frame_count": session.config_frame_count,
        "workflow_options": session.config_workflow_options,
    }


@router.get("/sessions/{session_id}/rounds/{assistant_message_id}")
def get_message_round(
    session_id: str,
    assistant_message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return one user message and its paired assistant response."""
    if len(assistant_message_id) > 50 or not assistant_message_id.endswith('-reply'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="助手消息 ID 格式无效")
    source_message_id = assistant_message_id.removesuffix('-reply')
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.user_id == current_user.id,
        ChatMessage.message_id.in_((source_message_id, assistant_message_id)),
    ).order_by(ChatMessage.created_at.asc()).all()
    if not any(message.message_id == source_message_id and message.type == 'user' for message in messages):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息轮次不存在")
    return {'messages': [_serialize_message(message) for message in messages]}


@router.patch("/messages/{message_id}")
def update_message_content(
    message_id: str,
    request: UpdateMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新用户消息内容；旧结果在新生成成功前继续保留。"""
    # 查找用户消息
    user_msg = db.query(ChatMessage).filter(
        ChatMessage.message_id == message_id,
        ChatMessage.user_id == current_user.id,
        ChatMessage.type == 'user'
    ).first()

    if not user_msg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="消息不存在"
        )

    # 更新可编辑字段
    update_data = request.model_dump(exclude_unset=True)
    stale_reference_paths = []
    for field in ('reference_image', 'reference_image_2', 'reference_image_3', 'reference_image_end'):
        if field in update_data:
            old_value = getattr(user_msg, field)
            if old_value and old_value != update_data[field]:
                stale_reference_paths.append(old_value)
    if 'content' in update_data:
        user_msg.content = update_data['content']
    if 'reference_image' in update_data:
        user_msg.reference_image = update_data['reference_image']
    if 'reference_image_2' in update_data:
        user_msg.reference_image_2 = update_data['reference_image_2']
    if 'reference_image_3' in update_data:
        user_msg.reference_image_3 = update_data['reference_image_3']
    if 'reference_image_end' in update_data:
        user_msg.reference_image_end = update_data['reference_image_end']
    if 'prompt_end' in update_data:
        user_msg.prompt_end = update_data['prompt_end']

    db.commit()
    delete_unreferenced_media(db, stale_reference_paths)
    print(f"[Session] 用户 {current_user.username} 编辑消息内容: {message_id}")
    return {"updated": True}


@router.delete("/sessions/{session_id}/messages/{message_id}")
def delete_message_round(
    session_id: str,
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除一轮对话（用户消息 + 紧随其后的 AI 回复）"""
    # 验证会话属于当前用户
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )

    # 查找指定的用户消息
    user_msg = db.query(ChatMessage).filter(
        ChatMessage.message_id == message_id,
        ChatMessage.session_id == session_id,
        ChatMessage.user_id == current_user.id,
        ChatMessage.type == 'user'
    ).first()

    if not user_msg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="消息不存在"
        )

    # 助手消息 ID 与用户消息 ID 精确配对，避免误删下一轮的回复。
    assistant_msg = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.user_id == current_user.id,
        ChatMessage.message_id == f'{message_id}-reply',
        ChatMessage.type == 'assistant',
    ).first()

    # 收集需要删除的磁盘文件
    messages_to_delete = [user_msg]
    if assistant_msg:
        messages_to_delete.append(assistant_msg)

    file_paths = _stored_media_paths(messages_to_delete)

    # 删除消息（ORM cascade 会自动删除关联的 GeneratedImage）
    for msg in messages_to_delete:
        db.delete(msg)
    db.commit()
    delete_unreferenced_media(db, file_paths)

    print(f"[Session] 用户 {current_user.username} 删除消息轮次: {message_id}")
    return {"deleted": True}
