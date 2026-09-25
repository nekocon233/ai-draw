"""
服务状态管理 API
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.auth import get_current_user
from server.schemas import ServiceStatusResponse
from server.generation.tasks import TaskBusyError
from server.lora_catalog import workflow_lora_options

router = APIRouter(prefix="/service", tags=["服务管理"])


@router.get("/pose-embedding-check", dependencies=[Depends(get_current_user)])
async def check_pose_embedding() -> JSONResponse:
    """The browser checks whether an enabled extension removed these headers."""
    return JSONResponse(
        {"probe": "pose-embedding-v1"},
        headers={
            "Content-Security-Policy": "frame-ancestors 'none'",
            "X-Frame-Options": "DENY",
            "Cache-Control": "no-store",
        },
    )


@router.get("/status", response_model=ServiceStatusResponse)
async def get_service_status(service: AIDrawService = Depends(get_ai_draw_service)) -> ServiceStatusResponse:
    """获取服务状态"""
    return ServiceStatusResponse(
        available=service.is_service_available,
        message="服务正常" if service.is_service_available else "服务不可用"
    )


@router.post("/start", dependencies=[Depends(get_current_user)])
async def start_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """启动服务"""
    await service.start_service()
    return {"success": True, "message": "服务已启动"}


@router.post("/stop", dependencies=[Depends(get_current_user)])
async def stop_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """停止服务"""
    if service.generation.tasks.active is not None:
        raise HTTPException(status_code=409, detail="已有生成任务正在运行，无法停止服务")
    service.stop_service()
    return {"success": True, "message": "服务已停止"}


@router.get("/workflows")
async def get_available_workflows(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """获取可用的工作流列表和默认工作流"""
    from utils.config_loader import get_config

    return {
        "workflows": service.catalog.list(),
        "default_workflow": get_config().workflow_defaults.current_workflow_type,
    }


@router.get("/loras", dependencies=[Depends(get_current_user)])
async def get_workflow_loras(
    workflow: str,
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    try:
        metadata = service.catalog.metadata(workflow)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if not metadata.get("lora_models"):
        return {"workflow": workflow, "models": []}
    try:
        node = await service.get_comfyui_object_info("LoraLoaderModelOnly")
        models = workflow_lora_options(metadata, node)
    except Exception as error:
        raise HTTPException(status_code=503, detail="暂时无法获取 LoRA 列表，请检查 ComfyUI 后重试") from error
    return {"workflow": workflow, "models": models}


@router.get("/workflow/defaults")
async def get_workflow_defaults() -> dict:
    """获取工作流默认配置"""
    from utils.config_loader import get_config
    config = get_config()
    return {
        "success": True,
        "defaults": config.workflow_defaults.model_dump()
    }


@router.post("/workflow/switch", dependencies=[Depends(get_current_user)])
async def switch_workflow(
    workflow_type: str,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> dict:
    """切换工作流"""
    try:
        service.switch_workflow(workflow_type)
    except TaskBusyError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"success": True, "workflow": workflow_type}
