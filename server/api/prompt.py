"""
AI Prompt 生成相关 API
"""
import os
import asyncio
import base64
from fastapi import APIRouter, HTTPException, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GeneratePromptRequest, GeneratePromptResponse, AnalyzePoseRequest, AnalyzePoseResponse, PosePresetResponse, AnalyzeImageForPromptRequest, AnalyzeImageForPromptResponse
from utils.config_loader import get_nano_banana_config

# 姿势迁移提示词前缀（前后端统一来源）
POSE_PRESET_PROMPT = "参照第二张图中人物的动作和姿态，将第一张图角色做出完全相同的动作，严格保持第一张图的画面尺寸、长宽比例、画风、镜头距离与视角、角色外形及背景，不得改变取景范围和画面裁切方式"

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


@router.post("/analyze-image", response_model=AnalyzeImageForPromptResponse)
async def analyze_image_for_prompt(request: AnalyzeImageForPromptRequest) -> AnalyzeImageForPromptResponse:
    """使用 Gemini 分析图片的风格、元素、动作、镜头等，生成适合文生图（Z-Image）的英文提示词"""
    api_key = os.getenv('NANO_BANANA_API_KEY', '')
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 NANO_BANANA_API_KEY，无法使用 AI 以图生词功能")
    if not request.image:
        raise HTTPException(status_code=400, detail="请提供图片")
    if not request.description or not request.description.strip():
        raise HTTPException(status_code=400, detail="请指定要描述的内容")

    nb_cfg = get_nano_banana_config()

    def strip_prefix(img: str) -> str:
        return img.split(',', 1)[1] if ',' in img else img

    def _call() -> str:
        from google import genai
        from google.genai import types

        if nb_cfg.base_url:
            client = genai.Client(
                http_options=types.HttpOptions(base_url=nb_cfg.base_url),
                api_key=api_key,
            )
        else:
            client = genai.Client(api_key=api_key)

        system_instruction = (
            "你是一个专业的 AI 图像生成提示词工程师，擅长为文生图模型（Z-Image，基于 Lumina2 架构）编写中文自然语言提示词。"
            "Z-Image 原生支持中文，请直接用中文描述。\n"
            "要求：只输出提示词本身，不要任何解释、标题、序号或额外内容。"
        )

        # 检测实际 MIME 类型
        raw_b64 = strip_prefix(request.image)
        prefix = request.image.split(';')[0] if request.image.startswith('data:') else ''
        mime = prefix.replace('data:', '') if prefix else 'image/png'

        user_parts: list[types.Part] = [
            types.Part(
                inline_data=types.Blob(
                    mime_type=mime,
                    data=base64.b64decode(raw_b64),
                )
            ),
        ]
        user_parts.append(types.Part(text=f"请分析这张图片，只生成以下要求的提示词：{request.description.strip()}"))

        contents = [
            types.Content(role="user", parts=[types.Part(text=system_instruction)]),
            types.Content(role="model", parts=[types.Part(text="好的，我会分析图片并按照格式生成中文自然语言提示词。")]),
            types.Content(role="user", parts=user_parts),
        ]

        response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=contents,
        )
        # 逐 part 提取文本（避免混有图片数据时 response.text 为 None）
        texts = []
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'text') and part.text:
                texts.append(part.text)
        return ''.join(texts).strip()

    try:
        prompt = await asyncio.to_thread(_call)
        return AnalyzeImageForPromptResponse(prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini 调用失败: {str(e)}")
