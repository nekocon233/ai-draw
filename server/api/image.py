"""
图像生成相关 API
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import base64
from io import BytesIO
from PIL import Image

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GenerateImageRequest, GenerateImageResponse

router = APIRouter(prefix="/image", tags=["图像生成"])


@router.post("/generate", response_model=GenerateImageResponse)
async def generate_image(
    request: GenerateImageRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> GenerateImageResponse:
    """生成图像 - 使用用户选择的工作流"""
    try:
        images = await service.generate_image(
            prompt=request.prompt,
            workflow=request.workflow,
            strength=request.strength,
            lora_prompt=request.lora_prompt,
            count=request.count,
            reference_image=request.reference_image,
        )
        return GenerateImageResponse(
            count=len(images),
            images=images
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-reference")
async def upload_reference_image(file: UploadFile = File(...)) -> dict:
    """上传参考图"""
    try:
        # 读取图片
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        
        # 转换为 RGB
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # 转换为 base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        return {
            "success": True,
            "image": f"data:image/png;base64,{img_str}"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图片处理失败: {str(e)}")


@router.get("/stop")
async def stop_generation(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """停止生成"""
    service.stop_generation()
    return {"success": True, "message": "已停止生成"}
