"""
AI Prompt 生成相关 API
"""
import os
import asyncio
from fastapi import APIRouter, HTTPException, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GeneratePromptRequest, GeneratePromptResponse, AnalyzePoseRequest, AnalyzePoseResponse, PosePresetResponse

# 姿势迁移提示词前缀（前后端统一来源）
POSE_PRESET_PROMPT = "参照第二张图中人物的动作和姿态，将第一张图角色做出完全相同的动作，严格保持第一张图的画面长宽比例、尺寸、画风、镜头距离与视角、角色外形及背景，不得改变取景范围和画面裁切方式"

router = APIRouter(prefix="/prompt", tags=["Prompt生成"])


@router.post("/generate", response_model=GeneratePromptResponse)
async def generate_prompt(
    request: GeneratePromptRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> GeneratePromptResponse:
    """根据中文描述生成英文 Prompt"""
    try:
        prompt = await service.generate_prompt(request.description, request.workflow_id)
        return GeneratePromptResponse(prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-pose", response_model=AnalyzePoseResponse)
async def analyze_pose(request: AnalyzePoseRequest) -> AnalyzePoseResponse:
    """使用 Gemini 分析参考图中的人物姿势，直接生成中文提示词"""
    api_key = os.getenv('NANO_BANANA_API_KEY', '')
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 NANO_BANANA_API_KEY，无法使用 AI 反推功能")
    if not request.images:
        raise HTTPException(status_code=400, detail="请至少提供一张参考图")

    # 剥离 data URL 前缀，转为纯 base64
    def strip_prefix(img: str) -> str:
        return img.split(',', 1)[1] if img.startswith('data:image') else img

    def _call() -> str:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-3.1-flash-image-preview")

        parts = []
        for img in request.images:
            parts.append({"inline_data": {"mime_type": "image/png", "data": strip_prefix(img)}})

        parts.append(
            "我给你提供了两张图片：第一张是需要改变姿势的角色图，第二张是姿势参考图。\n"
            "请仔细分析第二张图中人物的姿势动作，然后写一段图生图提示词，"
            "用于指导 AI 将第一张图中的角色改变为第二张图的姿势，同时保持第一张图角色的外形特征不变。\n"
            "输出格式严格为：\n"
            f"{POSE_PRESET_PROMPT}，"
            "[在此填入你对第二张图人物姿势的详细中文描述，包括四肢位置、身体朝向、手部动作、脚部动作、重心、表情等具体细节]\n"
            "只输出提示词本身，不要任何解释、标题或额外内容。"
        )

        response = model.generate_content(parts)
        return response.text.strip()

    try:
        prompt = await asyncio.to_thread(_call)
        return AnalyzePoseResponse(prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini 调用失败: {str(e)}")


@router.get("/pose-preset", response_model=PosePresetResponse)
async def get_pose_preset() -> PosePresetResponse:
    """返回姿势迁移预设提示词（前后端统一来源）"""
    return PosePresetResponse(prompt=POSE_PRESET_PROMPT)
