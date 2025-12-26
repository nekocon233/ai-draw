"""
FastAPI 主入口文件

提供 REST API 和 WebSocket 服务
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from utils.config_loader import get_config
from utils.file_storage import get_file_storage
from server.api import router as api_router
from server.websocket import router as ws_router
from server.ai_draw_service import get_ai_draw_service
from server.database import init_db
from server.middleware import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    print("[FastAPI] 正在初始化数据库...")
    init_db()
    
    print("[FastAPI] 正在初始化文件存储...")
    file_storage = get_file_storage()
    print(f"[FastAPI] 文件存储目录: {file_storage.upload_dir}")
    
    print("[FastAPI] 正在初始化 AI Draw 服务...")
    service = get_ai_draw_service()
    
    # 启动 ComfyUI 服务（可选，也可以通过 API 手动启动）
    try:
        await service.start_service()
        print("[FastAPI] ComfyUI 服务已启动")
    except Exception as e:
        print(f"[FastAPI] 启动 ComfyUI 服务失败: {e}")
        print("[FastAPI] 可以稍后通过 API 手动启动")
    
    yield
    
    # 关闭时清理
    print("[FastAPI] 正在关闭服务...")
    try:
        service.stop_service()
        print("[FastAPI] 服务已关闭")
    except Exception as e:
        print(f"[FastAPI] 关闭服务时出错: {e}")


# 加载配置
config = get_config()

# 创建 FastAPI 应用
app = FastAPI(
    title=config.app.name,
    version=config.app.version,
    lifespan=lifespan
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.server.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册异常处理器
register_exception_handlers(app)

# 注册路由
app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

# 挂载静态文件服务（上传的图片）
import os
upload_dir = config.paths.upload_dir
if os.path.exists(upload_dir):
    app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")
    print(f"[FastAPI] 静态文件服务已挂载: /uploads -> {upload_dir}")
else:
    print(f"[FastAPI] 警告: 上传目录不存在: {upload_dir}")

# 静态文件服务（生产环境 - 前端）
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy", "app": config.app.name, "version": config.app.version}


if __name__ == "__main__":
    server_config = config.server
    uvicorn.run(
        "server.main:app",
        host=server_config.host,
        port=server_config.port,
        reload=server_config.reload
    )
