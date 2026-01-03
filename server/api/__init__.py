"""
REST API 路由聚合器
整合所有API模块的路由
"""
from fastapi import APIRouter

# 导入各个模块的路由
from server.api import image, prompt, service
from server.api.user import router as user_router
from server.api.session import router as session_router

# 创建主路由
router = APIRouter()

# 注册子路由
router.include_router(image.router)
router.include_router(prompt.router)
router.include_router(service.router)
router.include_router(user_router)
router.include_router(session_router)

__all__ = ['router']


# ============ 以下是旧代码，保留用于向后兼容 ============
# TODO: 前端迁移完成后删除

from fastapi import UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import base64
from io import BytesIO
from PIL import Image

from server.ai_draw_service import AIDrawService, get_ai_draw_service


class GeneratePromptRequest(BaseModel):
    """生成 Prompt 请求"""
    description: str


class GenerateImageRequest(BaseModel):
    """生成图像请求"""
    prompt: str
    strength: float = 0.5
    lora_prompt: str = ""
    count: int = 1
    workflow_type: str = "通用"
    reference_image: Optional[str] = None


@router.post("/service/start")
async def start_service(service: AIDrawService = Depends(get_ai_draw_service)):
    """启动 ComfyUI 服务"""
    try:
        await service.start_service()
        return {"success": True, "message": "Service started"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Start failed: {str(e)}")


@router.post("/service/stop")
async def stop_service(service: AIDrawService = Depends(get_ai_draw_service)):
    """停止服务"""
    try:
        service.stop_service()
        return {"success": True, "message": "Service stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stop failed: {str(e)}")


@router.get("/service/status")
async def check_service_status(service: AIDrawService = Depends(get_ai_draw_service)):
    """检查服务状态"""
    try:
        available = await service.check_service_status()
        return {
            "available": available,
            "is_generating": service.is_generating,
            "is_generating_prompt": service.is_generating_prompt
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")


@router.post("/prompt/generate")
async def generate_prompt(
    request: GeneratePromptRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
):
    """生成 Prompt"""
    try:
        prompt = await service.generate_prompt(request.description)
        return {"success": True, "prompt": prompt}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generate failed: {str(e)}")


@router.post("/image/generate")
async def generate_image(
    request: GenerateImageRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
):
    """生成图像"""
    try:
        images = await service.generate_image(
            prompt=request.prompt,
            strength=request.strength,
            lora_prompt=request.lora_prompt,
            count=request.count,
            workflow_type=request.workflow_type,
            reference_image=request.reference_image
        )
        return {"success": True, "images": images, "count": len(images)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generate failed: {str(e)}")


@router.post("/image/upload")
async def upload_image(file: UploadFile = File(...)):
    """上传参考图片"""
    try:
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        
        # 转换为 base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode()
        
        return {
            "success": True,
            "image": f"data:image/png;base64,{img_base64}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.delete("/previews")
async def clear_previews(service: AIDrawService = Depends(get_ai_draw_service)):
    """清空预览图片"""
    service.clear_previews()
    return {"success": True, "message": "Previews cleared"}


@router.get("/previews")
async def get_previews(service: AIDrawService = Depends(get_ai_draw_service)):
    """获取预览图片列表"""
    return {"previews": service.preview_images}


@router.get("/workflows")
async def get_workflows(service: AIDrawService = Depends(get_ai_draw_service)):
    """获取可用工作流列表和元数据"""
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
            "parameters": metadata.get("parameters", [])  # 添加参数配置
        })
    
    return {
        "workflows": workflows,
        "default_workflow": service.get_current_workflow()
    }


@router.get("/workflow/defaults")
async def get_workflow_defaults():
    """获取工作流默认配置"""
    from utils.config_loader import get_config
    try:
        config = get_config()
        return {
            "success": True,
            "defaults": config.workflow_defaults.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get defaults: {str(e)}")


@router.post("/workflow/switch")
async def switch_workflow(
    workflow_type: str,
    service: AIDrawService = Depends(get_ai_draw_service)
):
    """切换工作流"""
    try:
        service.switch_workflow(workflow_type)
        return {"success": True, "workflow": workflow_type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Switch failed: {str(e)}")
