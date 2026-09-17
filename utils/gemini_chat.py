"""
Google Gemini 单轮图像生成

使用第三方兼容 API（或官方 Google API）调用 Gemini 进行单轮图像生成 / 编辑。
基于新版 google-genai SDK（google.genai）。
"""
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class GeminiChat:
    """Gemini 单轮图像生成封装（google-genai 新版 SDK）"""

    def __init__(
        self,
        api_key: str,
        model_name: str,
        base_url: str,
    ):
        self.api_key = api_key
        self.model_name = model_name
        self.base_url = base_url

    def generate(
        self,
        current_prompt: str,
        current_images: Optional[list[str]] = None,
    ) -> list[str]:
        """
        调用 Gemini API 生成图像（单轮）

        Args:
            current_prompt: 提示词
            current_images: 当前用户上传的图像 base64 列表（不含 data URL 前缀）

        Returns:
            生成图像的 base64 字符串列表（不含 data URL 前缀）
        """
        # 延迟导入，避免启动时 import 失败
        from google import genai
        from google.genai import types

        # ── 创建客户端 ────────────────────────────────────────────────────
        client = genai.Client(
            http_options=types.HttpOptions(base_url=self.base_url),
            api_key=self.api_key,
        )

        def _img_part(b64: str) -> types.Part:
            return types.Part(
                inline_data=types.Blob(
                    mime_type="image/png",
                    data=base64.b64decode(b64),
                )
            )

        # ── 构建当前用户消息 ──────────────────────────────────────────────
        current_parts: list[types.Part] = []
        for img_b64 in (current_images or []):
            if img_b64:
                try:
                    current_parts.append(_img_part(img_b64))
                except Exception as e:
                    logger.warning(f"[GeminiChat] 当前图片处理失败: {e}")

        if current_prompt:
            current_parts.append(types.Part(text=current_prompt))

        logger.info(f"[GeminiChat] 发送请求，当前图片: {len(current_images or [])}")

        # ── 调用 Gemini API（单轮 generate_content） ─────────────────────
        response = client.models.generate_content(
            model=self.model_name,
            contents=current_parts,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        # ── 提取生成的图像 ────────────────────────────────────────────────
        result_images: list[str] = []
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                result_images.append(
                    base64.b64encode(part.inline_data.data).decode("utf-8")
                )

        logger.info(f"[GeminiChat] 生成完成，共 {len(result_images)} 张图")
        return result_images
