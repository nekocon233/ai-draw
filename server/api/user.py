"""
用户认证和配置管理 API
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from server.database import get_db
from server.models import User, UserConfig, ChatMessage, ChatSession, GeneratedImage, ReferenceImage
from server.auth import (
    get_current_user,
    get_current_user_optional,
    hash_password,
    create_access_token,
    authenticate_user
)
from utils.file_storage import get_file_storage

router = APIRouter()

# ============ Pydantic 模型 ============

class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserConfigResponse(BaseModel):
    current_workflow: str
    prompt: str
    lora_prompt: str
    strength: float
    count: int
    images_per_row: int
    current_session_id: Optional[str] = None

class UpdateConfigRequest(BaseModel):
    current_workflow: Optional[str] = None
    prompt: Optional[str] = None
    lora_prompt: Optional[str] = None
    strength: Optional[float] = None
    count: Optional[int] = None
    images_per_row: Optional[int] = None
    current_session_id: Optional[str] = None

# ============ 用户认证 API ============

@router.post("/auth/register", response_model=TokenResponse)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    """用户注册"""
    # 检查用户名是否已存在
    existing = db.query(User).filter(User.username == request.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )
    
    # 创建用户
    user = User(
        username=request.username,
        password_hash=hash_password(request.password)
    )
    db.add(user)
    db.flush()  # 获取 user.id
    
    # 创建默认配置（从 workflow_metadata 读取）
    from utils.config_loader import get_config
    cfg = get_config()

    def get_default_param(name: str, fallback):
        value = cfg.workflow_defaults.get_workflow_parameter_default('t2i', name)
        return fallback if value is None else value
    
    config = UserConfig(
        user_id=user.id,
        current_workflow="t2i",
        prompt="",
        lora_prompt=get_default_param('lora_prompt', ""),
        strength=get_default_param('strength', 0.5),
        count=get_default_param('count', 1),
        images_per_row=cfg.workflow_defaults.col_count
    )
    db.add(config)
    db.commit()
    db.refresh(user)
    
    print(f"[Auth] 新用户注册: {user.username}")
    
    # 生成 Token
    token = create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=token)

@router.post("/auth/login", response_model=TokenResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """用户登录"""
    user = authenticate_user(db, request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 更新最后登录时间
    user.last_login = datetime.now()
    db.commit()
    
    print(f"[Auth] 用户登录: {user.username}")
    
    # 生成 Token
    token = create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=token)

# ============ 用户配置 API ============

@router.get("/config/user", response_model=UserConfigResponse)
def get_user_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户配置"""
    config = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
    if not config:
        # 创建默认配置（从 workflow_metadata 读取）
        from utils.config_loader import get_config
        cfg = get_config()

        def get_default_param(name: str, fallback):
            value = cfg.workflow_defaults.get_workflow_parameter_default('t2i', name)
            return fallback if value is None else value
        
        config = UserConfig(
            user_id=current_user.id,
            current_workflow="t2i",
            prompt="",
            lora_prompt=get_default_param('lora_prompt', ""),
            strength=get_default_param('strength', 0.5),
            count=get_default_param('count', 1),
            images_per_row=cfg.workflow_defaults.col_count
        )
        db.add(config)
        db.commit()
        db.refresh(config)

    prompt = config.prompt if config.prompt is not None else ""
    lora_prompt = config.lora_prompt if config.lora_prompt is not None else ""
    strength = config.strength if config.strength is not None else 0.5
    count = config.count if config.count is not None else 1
    
    return UserConfigResponse(
        current_workflow=config.current_workflow or "t2i",
        prompt=prompt,
        lora_prompt=lora_prompt,
        strength=strength,
        count=count,
        images_per_row=config.images_per_row,
        current_session_id=config.current_session_id
    )

@router.post("/config/user")
def update_user_config(
    request: UpdateConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新用户配置"""
    config = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
    if not config:
        config = UserConfig(user_id=current_user.id)
        db.add(config)
    
    # 更新配置字段
    update_data = request.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(config, key, value)
    
    config.updated_at = datetime.now()
    db.commit()
    
    return {"success": True, "message": "配置更新成功"}

@router.delete("/config/user")
def reset_user_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """重置用户配置为默认值"""
    config = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
    if config:
        # 从 workflow_metadata 读取默认值
        from utils.config_loader import get_config
        cfg = get_config()

        def get_default_param(name: str, fallback):
            value = cfg.workflow_defaults.get_workflow_parameter_default('t2i', name)
            return fallback if value is None else value
        
        config.current_workflow = "t2i"
        config.prompt = ""
        config.lora_prompt = get_default_param('lora_prompt', "")
        config.strength = get_default_param('strength', 0.5)
        config.count = get_default_param('count', 1)
        config.images_per_row = cfg.workflow_defaults.col_count
        config.updated_at = datetime.now()
        db.commit()
    
    return {"success": True, "message": "配置已重置"}

# ============ 聊天历史 API ============

@router.get("/chat/history")
def get_chat_history(
    limit: int = 50,
    session_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取聊天历史（支持按会话过滤）"""
    query = db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id)
    
    # 如果指定了会话ID，只返回该会话的消息
    if session_id:
        query = query.filter(ChatMessage.session_id == session_id)
    
    messages = query.order_by(ChatMessage.created_at.desc()).limit(limit).all()
    
    result = []
    for msg in reversed(messages):
        msg_dict = {
            "id": msg.message_id,
            "type": msg.type,
            "content": msg.content,
            "timestamp": int(msg.created_at.timestamp() * 1000),
        }
        
        if msg.type == "user" and msg.workflow:
            msg_dict["params"] = {
                "workflow": msg.workflow,
                "strength": msg.strength,
                "count": msg.count,
                "loraPrompt": msg.lora_prompt
            }
        elif msg.type == "assistant":
            # 加载关联的图片
            images = db.query(GeneratedImage)\
                .filter(GeneratedImage.message_id == msg.message_id)\
                .order_by(GeneratedImage.image_index)\
                .all()
            # 转换为 URL（如果是文件路径）或直接返回 base64
            file_storage = get_file_storage()
            msg_dict["images"] = [
                file_storage.get_file_url(img.file_path) 
                if not img.file_path.startswith('data:image') 
                else img.file_path 
                for img in images
            ]
        
        result.append(msg_dict)
    
    return {"messages": result}

@router.delete("/chat/history")
def clear_chat_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """清空聊天历史"""
    db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id).delete()
    db.commit()
    return {"success": True, "message": "聊天历史已清空"}

# ============ 参考图 API ============

@router.post("/reference-image")
def save_reference_image(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """保存参考图"""
    # 先清除旧的当前参考图标记
    db.query(ReferenceImage).filter(
        ReferenceImage.user_id == current_user.id,
        ReferenceImage.is_current == True
    ).update({"is_current": False})
    
    # 保存新的参考图到文件系统
    file_storage = get_file_storage()
    try:
        relative_path = file_storage.save_reference_image(
            base64_data=data["image"],
            user_id=current_user.id,
            filename=data.get("filename", "reference.png")
        )
        file_path = relative_path
    except Exception as e:
        print(f"[保存参考图] 失败: {e}")
        # 失败时依然使用 base64
        file_path = data["image"]
    
    ref_img = ReferenceImage(
        user_id=current_user.id,
        filename=data.get("filename", "reference.png"),
        file_path=file_path,
        is_current=True
    )
    db.add(ref_img)
    db.commit()
    return {"success": True}

@router.get("/reference-image")
def get_reference_image(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前参考图"""
    ref_img = db.query(ReferenceImage).filter(
        ReferenceImage.user_id == current_user.id,
        ReferenceImage.is_current == True
    ).first()
    
    if ref_img:
        # 转换为 URL（如果是文件路径）
        file_storage = get_file_storage()
        image_url = (
            file_storage.get_file_url(ref_img.file_path)
            if not ref_img.file_path.startswith('data:image')
            else ref_img.file_path
        )
        return {"image": image_url}
    return {"image": None}

@router.delete("/reference-image")
def clear_reference_image(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """清除当前参考图"""
    db.query(ReferenceImage).filter(
        ReferenceImage.user_id == current_user.id,
        ReferenceImage.is_current == True
    ).update({"is_current": False})
    db.commit()
    return {"success": True}

@router.post("/chat/save")
def save_chat_message(
    message: dict,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """保存单条聊天消息（游客模式下不保存）"""
    # 游客模式下直接返回成功，不保存到数据库
    if not current_user:
        return {"success": True, "message": "游客模式，消息未保存"}
    
    # 兼容两种字段名：id 或 message_id
    msg_id = message.get("message_id") or message.get("id")
    session_id = message.get("session_id")
    
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="缺少会话ID"
        )
    
    try:
        # 检查消息是否已存在
        existing = db.query(ChatMessage).filter(
            ChatMessage.user_id == current_user.id,
            ChatMessage.message_id == msg_id
        ).first()
        
        if existing:
            # 如果是 assistant 消息且有新图片，更新图片
            if message["type"] == "assistant" and "images" in message:
                file_storage = get_file_storage()
                for idx, img_data in enumerate(message["images"]):
                    if isinstance(img_data, str):  # base64 图片数据
                        try:
                            # 检查该图片是否已存在
                            existing_img = db.query(GeneratedImage).filter(
                                GeneratedImage.message_id == msg_id,
                                GeneratedImage.image_index == idx
                            ).first()
                            
                            if not existing_img:
                                relative_path = file_storage.save_generated_image(
                                    base64_data=img_data,
                                    user_id=current_user.id,
                                    message_id=msg_id,
                                    index=idx
                                )
                                gen_img = GeneratedImage(
                                    message_id=msg_id,
                                    file_path=relative_path,
                                    image_index=idx
                                )
                                db.add(gen_img)
                        except Exception as e:
                            print(f"保存图片失败: {e}")
                            continue
                
                db.commit()
            return {"success": True, "message": "消息已存在，已更新图片"}
        
        chat_msg = ChatMessage(
            session_id=session_id,
            user_id=current_user.id,
            message_id=msg_id,
            type=message["type"],
            content=message.get("content", ""),
            workflow=message.get("workflow"),
            strength=message.get("strength"),
            count=message.get("count"),
            lora_prompt=message.get("lora_prompt"),
        )
        db.add(chat_msg)
        
        # 如果是 assistant 消息，保存图片
        if message["type"] == "assistant" and "images" in message:
            file_storage = get_file_storage()
            for idx, img_data in enumerate(message["images"]):
                if isinstance(img_data, str):  # base64 图片数据
                    try:
                        # 保存到文件系统
                        relative_path = file_storage.save_generated_image(
                            base64_data=img_data,
                            user_id=current_user.id,
                            message_id=msg_id,
                            index=idx
                        )
                        gen_img = GeneratedImage(
                            message_id=msg_id,
                            image_index=idx,
                            file_path=relative_path  # 存储相对路径
                        )
                        db.add(gen_img)
                    except Exception as e:
                        print(f"[保存图片] 保存失败: {e}")
                        # 失败时依然保存 base64 作为备选
                        gen_img = GeneratedImage(
                            message_id=msg_id,
                            image_index=idx,
                            file_path=img_data
                        )
                        db.add(gen_img)
        
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        print(f"[保存消息] 错误: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"保存消息失败: {str(e)}"
        )
