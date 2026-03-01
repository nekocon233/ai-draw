"""
REST API 路由聚合器
整合所有API模块的路由
"""
from fastapi import APIRouter

# 导入各个模块的路由
from server.api import media, prompt, service
from server.api.user import router as user_router
from server.api.session import router as session_router

# 创建主路由
router = APIRouter()

# 注册子路由
router.include_router(media.router)
router.include_router(prompt.router)
router.include_router(service.router)
router.include_router(user_router)
router.include_router(session_router)

__all__ = ['router']
