"""
AI Prompt 生成相关 API
"""
import os
import asyncio
import base64
from fastapi import APIRouter, HTTPException, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import (
    GeneratePromptRequest, GeneratePromptResponse,
    PosePresetResponse,
    AnalyzeImageForPromptRequest, AnalyzeImageForPromptResponse,
    AnalyzeFramesForPromptRequest, AnalyzeFramesForPromptResponse,
)
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


@router.get("/pose-preset", response_model=PosePresetResponse)
async def get_pose_preset() -> PosePresetResponse:
    """返回姿势迁移预设提示词（前后端统一来源）"""
    return PosePresetResponse(prompt=POSE_PRESET_PROMPT)


@router.post("/analyze-image", response_model=AnalyzeImageForPromptResponse)
async def analyze_image_for_prompt(request: AnalyzeImageForPromptRequest) -> AnalyzeImageForPromptResponse:
    """使用 Gemini 分析单张图片的风格、元素、动作、镜头等，生成适合文生图（Z-Image）的中文提示词"""
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

        client = genai.Client(
            http_options=types.HttpOptions(base_url=nb_cfg.base_url),
            api_key=api_key,
        ) if nb_cfg.base_url else genai.Client(api_key=api_key)

        system_instruction = (
            "你是一个专业的 AI 图像生成提示词工程师，擅长为文生图模型（Z-Image，基于 Lumina2 架构）编写中文自然语言提示词。"
            "Z-Image 原生支持中文，请直接用中文描述。\n"
            "要求：只输出提示词本身，不要任何解释、标题、序号或额外内容。"
        )

        raw_b64 = strip_prefix(request.image)
        prefix = request.image.split(';')[0] if request.image.startswith('data:') else ''
        mime = prefix.replace('data:', '') if prefix else 'image/png'

        user_parts = [
            types.Part(inline_data=types.Blob(mime_type=mime, data=base64.b64decode(raw_b64))),
            types.Part(text=f"请分析这张图片，只生成以下要求的提示词：{request.description.strip()}"),
        ]
        contents = [
            types.Content(role="user", parts=[types.Part(text=system_instruction)]),
            types.Content(role="model", parts=[types.Part(text="好的，我会分析图片并按照格式生成中文自然语言提示词。")]),
            types.Content(role="user", parts=user_parts),
        ]
        response = client.models.generate_content(model="gemini-3.1-flash-image-preview", contents=contents)
        texts = [p.text for p in response.candidates[0].content.parts if hasattr(p, 'text') and p.text]
        return ''.join(texts).strip()

    try:
        prompt = await asyncio.to_thread(_call)
        return AnalyzeImageForPromptResponse(prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini 调用失败: {str(e)}")


@router.post("/analyze-frames", response_model=AnalyzeFramesForPromptResponse)
async def analyze_frames_for_prompt(request: AnalyzeFramesForPromptRequest) -> AnalyzeFramesForPromptResponse:
    """使用 Gemini 分析首尾帧过渡方向，分别生成「首帧→尾帧」和「尾帧→首帧」的 flf2v 过渡提示词"""
    api_key = os.getenv('NANO_BANANA_API_KEY', '')
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 NANO_BANANA_API_KEY，无法使用 AI 以图生词功能")
    if not request.image_start and not request.image_end:
        raise HTTPException(status_code=400, detail="请至少提供一张图片（首帧或尾帧）")

    nb_cfg = get_nano_banana_config()

    def strip_prefix(img: str) -> str:
        return img.split(',', 1)[1] if ',' in img else img

    def _call_transition(from_url: str, to_url: str | None, from_label: str, to_label: str) -> str:
        """生成从 from_label 过渡到 to_label 的 flf2v 提示词。
        若 to_url 为 None，仅根据起始帧推断过渡方式。"""
        from google import genai
        from google.genai import types

        client = genai.Client(
            http_options=types.HttpOptions(base_url=nb_cfg.base_url),
            api_key=api_key,
        ) if nb_cfg.base_url else genai.Client(api_key=api_key)

        def make_part(data_url: str) -> types.Part:
            raw_b64 = strip_prefix(data_url)
            prefix = data_url.split(';')[0] if data_url.startswith('data:') else ''
            mime = prefix.replace('data:', '') if prefix else 'image/png'
            return types.Part(inline_data=types.Blob(mime_type=mime, data=base64.b64decode(raw_b64)))

        is_dual = to_url is not None
        loop_note = "（视频将循环播放，首尾帧需能无缝衔接）" if request.is_loop else ""
        extra = f"\n补充要求：{request.description.strip()}" if request.description and request.description.strip() else ""

        if is_dual:
            system_instruction = (
                f"你是一个专业的 AI 视频生成提示词工程师，擅长为首尾帧视频模型（Wan2.2 flf2v）编写中文自然语言提示词{loop_note}。"
                f"你将收到两张图片：第一张是{from_label}，第二张是{to_label}。"
                f"请生成一段从{from_label}画面进入、展开并过渡到{to_label}画面的提示词，"
                "描述过渡过程中的主体动作、运镜方式、场景变化和氛围风格。\n"
                "要求：只输出提示词本身，不要任何解释、标题、序号或额外内容。"
            )
            user_parts = [
                make_part(from_url),
                make_part(to_url),  # type: ignore[arg-type]
                types.Part(text=f"第一张是{from_label}，第二张是{to_label}。请生成从{from_label}过渡到{to_label}的视频提示词。{extra}"),
            ]
        else:
            system_instruction = (
                f"你是一个专业的 AI 视频生成提示词工程师，擅长为首尾帧视频模型（Wan2.2 flf2v）编写中文自然语言提示词。"
                f"这张图片是视频的{from_label}，请根据内容推断可能的过渡动作、运镜和场景变化，生成适合视频展开的中文提示词。\n"
                "要求：只输出提示词本身，不要任何解释、标题、序号或额外内容。"
            )
            user_parts = [
                make_part(from_url),
                types.Part(text=f"请根据这张{from_label}图片，生成视频展开的提示词。{extra}"),
            ]

        contents = [
            types.Content(role="user", parts=[types.Part(text=system_instruction)]),
            types.Content(role="model", parts=[types.Part(text="好的，我会分析图片并生成指定方向的视频过渡提示词。")]),
            types.Content(role="user", parts=user_parts),
        ]
        response = client.models.generate_content(model="gemini-3.1-flash-image-preview", contents=contents)
        texts = [p.text for p in response.candidates[0].content.parts if hasattr(p, 'text') and p.text]
        return ''.join(texts).strip()

    try:
        start_url = request.image_start
        end_url = request.image_end

        # 并行生成两个方向的显渡提示词
        task_start = asyncio.to_thread(_call_transition, start_url, end_url, "首帧", "尾帧") \
            if start_url else asyncio.sleep(0, result='')
        task_end = asyncio.to_thread(_call_transition, end_url, start_url, "尾帧", "首帧") \
            if end_url else asyncio.sleep(0, result='')

        prompt_start, prompt_end = await asyncio.gather(task_start, task_end)
        return AnalyzeFramesForPromptResponse(prompt_start=prompt_start, prompt_end=prompt_end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini 调用失败: {str(e)}")
