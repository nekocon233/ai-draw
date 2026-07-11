"""
用户认证和授权
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from server.database import get_db
from server.models import User
from utils.config_loader import get_auth_config

# 密码加密上下文
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 从配置加载 JWT 设置
auth_config = get_auth_config()
SECRET_KEY = auth_config.jwt_secret_key
ALGORITHM = auth_config.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = auth_config.jwt_access_token_expire_minutes

# HTTP Bearer Token 验证
security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    """哈希密码"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """创建 JWT Token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_from_token(token: str, db: Session) -> Optional[User]:
    """验证 JWT 并返回仍处于启用状态的用户。"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
    except JWTError:
        return None
    return db.query(User).filter(User.username == username, User.is_active == True).first()

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    从 JWT Token 获取当前用户
    用于 FastAPI 依赖注入
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credentials_exception
    token = credentials.credentials
    
    user = get_user_from_token(token, db)
    if user is None:
        raise credentials_exception
    
    return user

def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """
    获取当前用户（可选）
    游客模式下返回 None，而不是抛出异常
    """
    if not credentials:
        return None
    
    return get_user_from_token(credentials.credentials, db)

def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """验证用户名和密码"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
