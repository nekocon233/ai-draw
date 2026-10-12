"""Agent bridge endpoints: identity, slot and task status, sessions, uploads, posted rounds and review gates.

Routes that publish WebSocket events are async so the event subscriber runs on the event loop.
"""
import asyncio
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from server.agent_bridge import gates as gate_rules
from server.agent_bridge.uploads import AgentUploadError, MAX_UPLOAD_BYTES, store_upload, sweep_orphans, user_upload_dir
from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.auth import get_current_user
from server.database import get_db
from server.models import ChatMessage, ChatSession, GeneratedImage, ReviewGate, User
from utils.media_file_references import canonical_upload_url, user_owns_media_path

router = APIRouter(prefix="/agent")


class AgentSessionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class AgentRoundRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=50)
    text: str = Field(default="", max_length=8000)
    media: List[str] = Field(min_length=1, max_length=32)


class GateCreateRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=50)
    question: str = Field(min_length=1, max_length=1000)
    job: Optional[str] = Field(default=None, max_length=80)
    step: Optional[str] = Field(default=None, max_length=80)
    min_picks: int = Field(default=1, ge=0, le=gate_rules.MAX_PICKS_LIMIT)
    max_picks: int = Field(default=1, ge=0, le=gate_rules.MAX_PICKS_LIMIT)
    rounds: Optional[List[str]] = Field(default=None, max_length=64)
    replace_open: bool = False


class GatePick(BaseModel):
    url: str = Field(min_length=1, max_length=1000)
    message_id: Optional[str] = Field(default=None, max_length=50)


class GatePicksRequest(BaseModel):
    picks: List[GatePick] = Field(default_factory=list, max_length=gate_rules.MAX_PICKS_LIMIT)


class GateSubmitRequest(BaseModel):
    decision: Literal["approve", "redo"]
    picks: Optional[List[GatePick]] = Field(default=None, max_length=gate_rules.MAX_PICKS_LIMIT)
    note: str = Field(default="", max_length=4000)


class GateCancelRequest(BaseModel):
    reason: str = Field(default="", max_length=200)


def _ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def _owned_session(db: Session, user_id: int, session_id: str, lock: bool = False) -> ChatSession:
    query = db.query(ChatSession).filter(ChatSession.session_id == session_id, ChatSession.user_id == user_id)
    session = (query.with_for_update() if lock else query).first()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


def _owned_gate(db: Session, user_id: int, gate_id: str, lock: bool = False) -> ReviewGate:
    query = db.query(ReviewGate).filter(ReviewGate.gate_id == gate_id, ReviewGate.user_id == user_id)
    gate = (query.with_for_update() if lock else query).first()
    if gate is None:
        raise HTTPException(status_code=404, detail="审核不存在")
    return gate


def _publish_gate(service: AIDrawService, gate: ReviewGate) -> dict:
    payload = gate_rules.serialize_gate(gate)
    service.events.user(gate.user_id, "agent_gate", payload)
    return payload


@router.get("/me")
def agent_me(current_user: User = Depends(get_current_user)) -> dict:
    return {"user_id": current_user.id, "username": current_user.username}


@router.get("/slot")
def agent_slot(
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    """Whether the single generation slot is free; another user's task shows only as busy."""
    active = service.generation.tasks.active
    if active is None:
        return {"busy": False}
    context = active.context
    if context.user_id != current_user.id:
        return {"busy": True, "mine": False}
    return {
        "busy": True,
        "mine": True,
        "task_id": context.task_id,
        "session_id": context.session_id,
        "message_id": context.message_id,
        "workflow": context.workflow,
        "phase": active.phase,
        "artifact_count": len(active.artifacts),
    }


@router.get("/tasks/{task_id}")
def agent_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    snapshot = service.generation.tasks.task(current_user.id, task_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="任务不存在或记录已过期")
    return snapshot


@router.post("/sessions")
async def create_agent_session(
    request: AgentSessionRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """Same defaults as a UI session, but an empty composer instead of one prefilled from agent prompts."""
    from utils.config_loader import get_config

    defaults = get_config().workflow_defaults
    workflow = defaults.current_workflow_type
    session = ChatSession(
        session_id=f"session-{uuid.uuid4()}",
        user_id=current_user.id,
        title=request.title.strip() or "Agent",
        config_workflow=workflow,
        config_prompt="",
        config_lora_prompt=defaults.get_workflow_parameter_default(workflow, "lora_prompt"),
        config_strength=defaults.get_workflow_parameter_default(workflow, "strength"),
        config_count=defaults.get_workflow_parameter_default(workflow, "count"),
        config_images_per_row=defaults.col_count,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    service.events.user(current_user.id, "agent_session", {"reason": "session_created", "session_id": session.session_id})
    return {"session_id": session.session_id, "title": session.title, "created_at": _ms(session.created_at)}


@router.post("/uploads")
async def upload_agent_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Store an image or video exactly as sent and return a URL owned by the caller."""
    directory = user_upload_dir(current_user.id)
    directory.mkdir(parents=True, exist_ok=True)
    partial = directory / f".{uuid.uuid4().hex}.part"
    try:
        size = 0
        with open(partial, "wb") as output:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="文件不能超过 100MB")
                output.write(chunk)
        stored = await asyncio.to_thread(store_upload, partial, current_user.id)
    except AgentUploadError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    finally:
        partial.unlink(missing_ok=True)
    try:
        sweep_orphans(db, current_user.id, keep={stored.url.rsplit("/", 1)[-1]})
    except Exception as error:
        print(f"[agent] 清理旧上传失败: {error}")
    return stored.to_dict()


@router.post("/rounds")
async def post_agent_round(
    request: AgentRoundRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """Show agent-made media (cleaned sprites, contact sheets, previews) as one round of the session."""
    session = _owned_session(db, current_user.id, request.session_id)
    media = []
    for url in request.media:
        canonical = canonical_upload_url(url)
        if canonical is None:
            raise HTTPException(status_code=422, detail="媒体地址无效")
        if not user_owns_media_path(db, current_user.id, canonical):
            raise HTTPException(status_code=403, detail="媒体文件不属于当前用户")
        media.append(canonical)
    message_id = f"msg-{uuid.uuid4()}"
    reply_id = f"{message_id}-reply"
    now = datetime.now()
    db.add(ChatMessage(session_id=session.session_id, user_id=current_user.id, message_id=message_id,
                       type="user", content=request.text, created_at=now))
    db.add(ChatMessage(session_id=session.session_id, user_id=current_user.id, message_id=reply_id,
                       type="assistant", content="", created_at=now))
    db.flush()
    db.add_all([GeneratedImage(message_id=reply_id, image_index=index, file_path=url) for index, url in enumerate(media)])
    session.updated_at = now
    db.commit()
    service.events.user(current_user.id, "agent_session", {
        "reason": "round_posted", "session_id": session.session_id, "message_id": message_id, "reply_id": reply_id,
    })
    return {"session_id": session.session_id, "message_id": message_id, "reply_id": reply_id, "media": media, "created_at": _ms(now)}


@router.post("/gates")
async def create_gate(
    request: GateCreateRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """Open a review question on a session; a session has at most one open gate."""
    # Locking the session row serializes concurrent opens on the same session.
    session = _owned_session(db, current_user.id, request.session_id, lock=True)
    try:
        min_picks, max_picks = gate_rules.normalize_limits(request.min_picks, request.max_picks)
    except gate_rules.GateError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    replaced = db.query(ReviewGate).filter(
        ReviewGate.session_id == session.session_id,
        ReviewGate.user_id == current_user.id,
        ReviewGate.status == gate_rules.GATE_OPEN,
    ).all()
    if replaced and not request.replace_open:
        raise HTTPException(status_code=409, detail="这个会话已有进行中的审核")
    for old in replaced:
        old.status = gate_rules.GATE_CANCELLED
        old.cancel_reason = "已被新的审核替换"
    gate = ReviewGate(
        gate_id=gate_rules.new_gate_id(),
        user_id=current_user.id,
        session_id=session.session_id,
        job=request.job,
        step=request.step,
        question=request.question.strip(),
        min_picks=min_picks,
        max_picks=max_picks,
        rounds=request.rounds or [],
        status=gate_rules.GATE_OPEN,
        picks=[],
        note="",
    )
    db.add(gate)
    db.commit()
    for old in replaced:
        db.refresh(old)
        _publish_gate(service, old)
    db.refresh(gate)
    return _publish_gate(service, gate)


@router.get("/gates")
def list_gates(
    session_id: Optional[str] = Query(default=None, max_length=50),
    status: Optional[Literal["open", "submitted", "cancelled"]] = None,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(ReviewGate).filter(ReviewGate.user_id == current_user.id)
    if session_id:
        query = query.filter(ReviewGate.session_id == session_id)
    if status:
        query = query.filter(ReviewGate.status == status)
    gates = query.order_by(ReviewGate.created_at.desc(), ReviewGate.id.desc()).limit(limit).all()
    return {"gates": [gate_rules.serialize_gate(gate) for gate in gates]}


@router.get("/gates/{gate_id}")
def get_gate(
    gate_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return gate_rules.serialize_gate(_owned_gate(db, current_user.id, gate_id))


@router.put("/gates/{gate_id}/picks")
async def set_gate_picks(
    gate_id: str,
    request: GatePicksRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """Replace the current selection of an open gate (the UI sends the whole list)."""
    gate = _owned_gate(db, current_user.id, gate_id, lock=True)
    try:
        gate_rules.require_open(gate)
        picks = gate_rules.resolve_picks(db, gate, [pick.model_dump() for pick in request.picks])
        gate_rules.check_pick_count(gate, len(picks))
    except gate_rules.GateError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    gate.picks = picks
    gate.updated_at = datetime.now()
    db.commit()
    db.refresh(gate)
    return _publish_gate(service, gate)


@router.post("/gates/{gate_id}/submit")
async def submit_gate(
    gate_id: str,
    request: GateSubmitRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """Approve the picks, or ask for a redo (picks optional, usually with a note)."""
    gate = _owned_gate(db, current_user.id, gate_id, lock=True)
    try:
        gate_rules.require_open(gate)
        requested = [pick.model_dump() for pick in request.picks] if request.picks is not None else list(gate.picks or [])
        # Results can be deleted after they were picked; resolve again before handing them over.
        picks = gate_rules.resolve_picks(db, gate, requested)
        gate_rules.check_pick_count(gate, len(picks), request.decision)
    except gate_rules.GateError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    now = datetime.now()
    gate.picks = picks
    gate.note = request.note.strip()
    gate.decision = request.decision
    gate.status = gate_rules.GATE_SUBMITTED
    gate.submitted_at = now
    gate.updated_at = now
    db.commit()
    db.refresh(gate)
    return _publish_gate(service, gate)


@router.post("/gates/{gate_id}/cancel")
async def cancel_gate(
    gate_id: str,
    request: GateCancelRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    gate = _owned_gate(db, current_user.id, gate_id, lock=True)
    try:
        gate_rules.require_open(gate)
    except gate_rules.GateError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    gate.status = gate_rules.GATE_CANCELLED
    gate.cancel_reason = request.reason.strip() or None
    gate.updated_at = datetime.now()
    db.commit()
    db.refresh(gate)
    return _publish_gate(service, gate)
