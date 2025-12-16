"""
服务状态管理 API
"""
from fastapi import APIRouter, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import ServiceStatusResponse

router = APIRouter(prefix="/service", tags=["服务管理"])


@router.get("/status", response_model=ServiceStatusResponse)
async def get_service_status(service: AIDrawService = Depends(get_ai_draw_service)) -> ServiceStatusResponse:
    """获取服务状态"""
    return ServiceStatusResponse(
        available=service.is_service_available,
        message="服务正常" if service.is_service_available else "服务不可用"
    )


@router.post("/start")
async def start_service(service: AIDrawService = Depends(get_service)) -> dict:
    """启动服务"""
    await service.start_service()
    return {"success": True, "message": "服务已启动"}


@router.post("/stop")
async def stop_service(service: AIDrawService = Depends(get_service)) -> dict:
    """停止服务"""
    await service.stop_service()
    return {"success": True, "message": "服务已停止"}


@router.get("/workflows")
async def get_available_workflows(service: AIDrawService = Depends(get_service)) -> dict:
    """获取可用的工作流列表"""
    return {
        "workflows": service.get_available_workflows()
    }
