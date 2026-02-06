"""
数据库连接和会话管理
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from contextlib import contextmanager
from utils.config_loader import get_database_config
import time

# 从配置加载数据库连接信息
db_config = get_database_config()

if db_config.host == "sqlite":
    DATABASE_URL = f"sqlite:///./{db_config.name}.db"
    connect_args = {"check_same_thread": False}
else:
    DATABASE_URL = f"postgresql://{db_config.user}:{db_config.password}@{db_config.host}:{db_config.port}/{db_config.name}"
    connect_args = {"connect_timeout": 10}

# 创建数据库引擎
engine = create_engine(
    DATABASE_URL,
    pool_size=10,  # 连接池大小
    max_overflow=20,  # 最大溢出连接数
    pool_pre_ping=True,  # 连接前测试
    echo=False,  # 生产环境设为 False
    connect_args=connect_args
)

# 会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ORM 基类
Base = declarative_base()

def init_db():
    """初始化数据库（创建所有表），支持重试"""
    max_retries = 5
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            # 测试连接
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            
            # 创建表
            Base.metadata.create_all(bind=engine)
            print("[Database] 数据库表初始化完成")
            return
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"[Database] 连接失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                print(f"[Database] {retry_delay} 秒后重试...")
                time.sleep(retry_delay)
            else:
                print(f"[Database] 数据库初始化失败: {e}")
                raise

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
