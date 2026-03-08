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
async def start_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """启动服务"""
    await service.start_service()
    return {"success": True, "message": "服务已启动"}


@router.post("/stop")
async def stop_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """停止服务"""
    await service.stop_service()
    return {"success": True, "message": "服务已停止"}


@router.get("/workflows")
async def get_available_workflows(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """获取可用的工作流列表和默认工作流"""
    from utils.config_loader import get_config
    config = get_config()
    
    # 获取所有工作流及其元数据
    workflows = []
    for workflow_key in service.get_available_workflows():
        metadata = config.workflow_defaults.workflow_metadata.get(workflow_key, {})
        workflows.append({
            "key": workflow_key,
            "label": metadata.get("label", workflow_key),
            "description": metadata.get("description", ""),
            "requires_image": metadata.get("requires_image", False),
            "requires_end_image": metadata.get("requires_end_image", False),
            "supports_original_size": metadata.get("supports_original_size", False),
            "supports_loop": metadata.get("supports_loop", False),
            "output_type": metadata.get("output_type", "image"),
            "parameters": metadata.get("parameters", [])  # 添加参数配置
        })
    
    return {
        "workflows": workflows,
        "default_workflow": service.get_current_workflow()
    }


@router.get("/workflow/defaults")
async def get_workflow_defaults() -> dict:
    """获取工作流默认配置"""
    from utils.config_loader import get_config
    config = get_config()
    return {
        "success": True,
        "defaults": config.workflow_defaults.model_dump()
    }


@router.post("/workflow/switch")
async def switch_workflow(
    workflow_type: str,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> dict:
    """切换工作流"""
    service.switch_workflow(workflow_type)
    return {"success": True, "workflow": workflow_type}
