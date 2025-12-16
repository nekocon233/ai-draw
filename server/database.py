"""
数据库连接和会话管理
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from contextlib import contextmanager
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# PostgreSQL 连接配置
# 从环境变量读取数据库连接信息
DB_HOST = os.getenv("DATABASE_HOST", "192.168.100.195")
DB_PORT = os.getenv("DATABASE_PORT", "5432")
DB_NAME = os.getenv("DATABASE_NAME", "mydb")
DB_USER = os.getenv("DATABASE_USER", "root")
DB_PASSWORD = os.getenv("DATABASE_PASSWORD", "bilibili")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# 创建数据库引擎
engine = create_engine(
    DATABASE_URL,
    pool_size=10,  # 连接池大小
    max_overflow=20,  # 最大溢出连接数
    pool_pre_ping=True,  # 连接前测试
    echo=False,  # 生产环境设为 False
)

# 会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ORM 基类
Base = declarative_base()

def init_db():
    """初始化数据库（创建所有表）"""
    Base.metadata.create_all(bind=engine)
    print("[Database] 数据库表初始化完成")

def get_db():
    """
    依赖注入：获取数据库会话
    用于 FastAPI 路由
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@contextmanager
def get_db_session():
    """
    上下文管理器：获取数据库会话
    用于非 FastAPI 场景
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
