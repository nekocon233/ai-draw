"""
媒体生成相关 API（图像 / 视频）
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
import base64
from io import BytesIO
from PIL import Image

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GenerateMediaRequest, GenerateMediaResponse

router = APIRouter(prefix="/media", tags=["媒体生成"])


@router.post("/generate", response_model=GenerateMediaResponse)
async def generate_media(
    request: GenerateMediaRequest,
    background_tasks: BackgroundTasks,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> GenerateMediaResponse:
    """生成媒体 - 使用用户选择的工作流（立即返回，结果通过 WebSocket 推送）"""

    async def _run_generation():
        try:
            await service.generate_media(
                prompt=request.prompt,
                workflow=request.workflow,
                strength=request.strength,
                lora_prompt=request.lora_prompt,
                count=request.count,
                reference_image=request.reference_image,
                width=request.width,
                height=request.height,
                prompt_end=request.prompt_end,
                reference_image_end=request.reference_image_end,
                use_original_size=request.use_original_size,
                is_loop=request.is_loop,
                start_frame_count=request.start_frame_count,
                end_frame_count=request.end_frame_count,
                frame_rate=request.frame_rate,
            )
        except Exception as e:
            # 通过 WebSocket 推送错误信息
            service._notify_state_change('error', str(e))
            # 重置生成状态
            service.is_generating = False
            service._notify_state_change('is_generating', False)

    background_tasks.add_task(_run_generation)
    return GenerateMediaResponse(count=0, images=[])


@router.post("/upload-reference")
async def upload_reference_media(file: UploadFile = File(...)) -> dict:
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
