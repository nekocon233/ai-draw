"""
用户认证和配置管理 API
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional

from server.database import get_db
from server.models import User, UserConfig, ChatMessage, GeneratedImage, ReferenceImage
from server.auth import (
    get_current_user,
    hash_password,
    create_access_token,
    authenticate_user
)

router = APIRouter()

# ============ Pydantic 模型 ============

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[EmailStr] = None

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

class UpdateConfigRequest(BaseModel):
    current_workflow: Optional[str] = None
    prompt: Optional[str] = None
    lora_prompt: Optional[str] = None
    strength: Optional[float] = None
    count: Optional[int] = None
    images_per_row: Optional[int] = None

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
        password_hash=hash_password(request.password),
        email=request.email
    )
    db.add(user)
    db.flush()  # 获取 user.id
    
    # 创建默认配置
    config = UserConfig(user_id=user.id)
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
    user.last_login = datetime.utcnow()
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
        # 创建默认配置
        config = UserConfig(user_id=current_user.id)
        db.add(config)
        db.commit()
        db.refresh(config)
    
    return UserConfigResponse(
        current_workflow=config.current_workflow,
        prompt=config.prompt,
        lora_prompt=config.lora_prompt,
        strength=config.strength,
        count=config.count,
        images_per_row=config.images_per_row
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
    
    config.updated_at = datetime.utcnow()
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
        config.current_workflow = "参考"
        config.prompt = "1girl"
        config.lora_prompt = "<lora:Ameniwa:0.6>"
        config.strength = 0.8
        config.count = 1
        config.images_per_row = 4
        config.updated_at = datetime.utcnow()
        db.commit()
    
    return {"success": True, "message": "配置已重置"}

# ============ 聊天历史 API ============

@router.get("/chat/history")
def get_chat_history(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取聊天历史"""
    messages = db.query(ChatMessage)\
        .filter(ChatMessage.user_id == current_user.id)\
        .order_by(ChatMessage.created_at.desc())\
        .limit(limit)\
        .all()
    
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
            # 返回 base64 图片数据
            msg_dict["images"] = [img.file_path for img in images]
        
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
    
    # 保存新的参考图
    ref_img = ReferenceImage(
        user_id=current_user.id,
        filename=data.get("filename", "reference.png"),
        file_path=data["image"],  # base64 数据
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
        return {"image": ref_img.file_path}
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """保存单条聊天消息"""
    # 兼容两种字段名：id 或 message_id
    msg_id = message.get("message_id") or message.get("id")
    
    # 检查消息是否已存在
    existing = db.query(ChatMessage).filter(
        ChatMessage.user_id == current_user.id,
        ChatMessage.message_id == msg_id
    ).first()
    
    if existing:
        return {"success": True, "message": "消息已存在"}
    
    chat_msg = ChatMessage(
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
        for idx, img_data in enumerate(message["images"]):
            if isinstance(img_data, str):  # base64 图片数据
                gen_img = GeneratedImage(
                    message_id=msg_id,
                    image_index=idx,
                    file_path=img_data  # 直接存储 base64
                )
                db.add(gen_img)
    
    db.commit()
    return {"success": True}
