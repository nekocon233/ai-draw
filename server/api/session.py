"""
聊天会话管理 API
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional

from server.database import get_db
from server.models import ChatSession, ChatMessage, User
from server.auth import get_current_user

router = APIRouter(prefix="/chat")

# ============ Pydantic 模型 ============

class CreateSessionRequest(BaseModel):
    session_id: str
    title: Optional[str] = "新对话"

class UpdateSessionTitleRequest(BaseModel):
    title: str

class SessionResponse(BaseModel):
    id: str
    title: str
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
    prompt_end: Optional[str] = None
    reference_image_end: Optional[str] = None
    is_loop: Optional[bool] = None
    start_frame_count: Optional[int] = None
    end_frame_count: Optional[int] = None
    frame_rate: Optional[float] = None

# ============ 会话管理 API ============

@router.get("/sessions", response_model=List[SessionResponse])
def get_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户的所有会话列表"""
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).all()
    
    result = []
    for session in sessions:
        # 统计该会话的消息数量
        message_count = db.query(func.count(ChatMessage.id)).filter(
            ChatMessage.session_id == session.session_id
        ).scalar() or 0
        
        result.append(SessionResponse(
            id=session.session_id,
            title=session.title,
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
    db.delete(session)
    db.commit()
    
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
    
    session.updated_at = datetime.now()
    db.commit()
    
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
        "prompt_end": session.config_prompt_end,
        "reference_image_end": session.config_reference_image_end,
        "is_loop": session.config_is_loop,
        "start_frame_count": session.config_start_frame_count,
        "end_frame_count": session.config_end_frame_count,
        "frame_rate": session.config_frame_rate,
    }
