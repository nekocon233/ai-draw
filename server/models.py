"""
数据库 ORM 模型
"""
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from server.database import Base

class User(Base):
    """用户表"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    email = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    
    # 关系
    config = relationship("UserConfig", back_populates="user", uselist=False, cascade="all, delete-orphan")
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    messages = relationship("ChatMessage", back_populates="user", cascade="all, delete-orphan")
    reference_images = relationship("ReferenceImage", back_populates="user", cascade="all, delete-orphan")

class UserConfig(Base):
    """用户配置表"""
    __tablename__ = "user_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    
    # 工作流配置（默认值在创建时从配置读取）
    current_workflow = Column(String(20), nullable=True)
    prompt = Column(Text, nullable=True)
    lora_prompt = Column(String(255), nullable=True)
    strength = Column(Float, nullable=True)
    count = Column(Integer, nullable=True)
    images_per_row = Column(Integer, default=4)
    current_session_id = Column(String(100), nullable=True)  # 当前选中的会话ID
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    user = relationship("User", back_populates="config")

class ReferenceImage(Base):
    """参考图片表"""
    __tablename__ = "reference_images"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255))
    file_path = Column(Text, nullable=False)  # 存储相对文件路径（登录用户）或 base64（游客模式）
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    is_current = Column(Boolean, default=False)  # 是否为当前参考图
    
    # 关系
    user = relationship("User", back_populates="reference_images")

class ChatSession(Base):
    """聊天会话表"""
    __tablename__ = "chat_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), default="新对话")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    
    # 会话配置（独立于用户全局配置，默认值在创建时从配置读取）
    config_workflow = Column(String(20), nullable=True)
    config_prompt = Column(Text, nullable=True)
    config_lora_prompt = Column(String(255), nullable=True)
    config_strength = Column(Float, nullable=True)
    config_count = Column(Integer, nullable=True)
    config_images_per_row = Column(Integer, default=4)
    config_reference_image = Column(Text, nullable=True)  # base64 编码的参考图
    
    # 关系
    user = relationship("User", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

class ChatMessage(Base):
    """聊天消息表"""
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(String(50), unique=True, nullable=False, index=True)
    type = Column(String(10), nullable=False)  # 'user' or 'assistant'
    content = Column(Text)
    
    # 生成参数（仅 user 类型消息有值）
    workflow = Column(String(20))
    strength = Column(Float)
    count = Column(Integer)
    lora_prompt = Column(String(255))
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # 关系
    session = relationship("ChatSession", back_populates="messages")
    user = relationship("User", back_populates="messages")
    images = relationship("GeneratedImage", back_populates="message", cascade="all, delete-orphan")

class GeneratedImage(Base):
    """生成的图片表"""
    __tablename__ = "generated_images"
    
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String(50), ForeignKey("chat_messages.message_id", ondelete="CASCADE"), nullable=False)
    image_index = Column(Integer)  # 图片在消息中的索引
    file_path = Column(Text, nullable=False)  # 存储相对文件路径（登录用户）或 base64（游客模式）
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 关系
    message = relationship("ChatMessage", back_populates="images")
