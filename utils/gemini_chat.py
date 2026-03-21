"""
Google Gemini 多轮对话图像生成

使用第三方兼容 API（或官方 Google API）调用 Gemini 实现携带历史的多轮图像生成。
基于新版 google-genai SDK（google.genai）。
"""
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class GeminiChat:
    """Gemini 多轮对话图像生成封装（google-genai 新版 SDK）"""

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-3-pro-image-preview",
        base_url: str = "",
    ):
        self.api_key = api_key
        self.model_name = model_name
        self.base_url = base_url

    def generate(
        self,
        current_prompt: str,
        current_images: Optional[list[str]] = None,
        history: Optional[list[dict]] = None,
        context_image: Optional[str] = None,
    ) -> list[str]:
        """
        调用 Gemini API 生成图像（多轮对话）

        Args:
            current_prompt: 当前轮次的提示词
            current_images: 当前轮次用户上传的图像 base64 列表（不含 data URL 前缀）
            history: 历史对话列表，每条为 dict:
                     {
                         "prompt": str,              # 用户提示词
                         "images": list[str],        # 用户上传图片 base64 列表
                         "result_images": list[str], # AI 生成图片 base64 列表
                     }
            context_image: 上一轮 AI 生成的图片 base64（当前轮无参考图时自动注入）

        Returns:
            生成图像的 base64 字符串列表（不含 data URL 前缀）
        """
        # 延迟导入，避免启动时 import 失败
        from google import genai
        from google.genai import types

        # ── 创建客户端 ────────────────────────────────────────────────────
        if self.base_url:
            client = genai.Client(
                http_options=types.HttpOptions(base_url=self.base_url),
                api_key=self.api_key,
            )
        else:
            client = genai.Client(api_key=self.api_key)

        # ── 构建历史对话内容 ──────────────────────────────────────────────
        # AI 生成图片放回 user 角色（紧跟当轮用户消息），
        # model 角色仅保留纯文本占位，避免 thought_signature 问题。
        def _img_part(b64: str) -> types.Part:
            return types.Part(
                inline_data=types.Blob(
                    mime_type="image/png",
                    data=base64.b64decode(b64),
                )
            )

        chat_history: list[types.Content] = []
        for turn in (history or []):
            user_parts: list[types.Part] = []

            # 用户上传的参考图
            for img_b64 in (turn.get("images") or []):
                if img_b64:
                    try:
                        user_parts.append(_img_part(img_b64))
                    except Exception as e:
                        logger.warning(f"[GeminiChat] 历史参考图处理失败: {e}")

            # 用户提示词
            if turn.get("prompt"):
                user_parts.append(types.Part(text=turn["prompt"]))

            # AI 生成结果图也放入 user_parts（紧跟在用户消息之后）
            for img_b64 in (turn.get("result_images") or []):
                if img_b64:
                    try:
                        user_parts.append(_img_part(img_b64))
                    except Exception as e:
                        logger.warning(f"[GeminiChat] 历史生成图处理失败: {e}")

            if user_parts:
                chat_history.append(types.Content(role="user", parts=user_parts))

            # Model 回复使用纯文本占位
            chat_history.append(
                types.Content(role="model", parts=[types.Part(text="Image generated.")])
            )

        # ── 构建当前用户消息 ──────────────────────────────────────────────
        current_parts: list[types.Part] = []

        # 若当前轮无用户参考图，但有上一轮生成结果，则注入作为上下文
        if context_image and not current_images:
            try:
                current_parts.append(_img_part(context_image))
            except Exception as e:
                logger.warning(f"[GeminiChat] context_image 注入失败: {e}")

        for img_b64 in (current_images or []):
            if img_b64:
                try:
                    current_parts.append(_img_part(img_b64))
                except Exception as e:
                    logger.warning(f"[GeminiChat] 当前图片处理失败: {e}")

        if current_prompt:
            current_parts.append(types.Part(text=current_prompt))

        logger.info(
            f"[GeminiChat] 发送请求，历史轮次: {len(history or [])}，"
            f"历史图片对: {sum(len(t.get('result_images') or []) for t in (history or []))}，"
            f"当前图片: {len(current_images or [])}"
        )

        # ── 调用 Gemini API ───────────────────────────────────────────────
        chat = client.chats.create(
            model=self.model_name,
            history=chat_history,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )
        response = chat.send_message(current_parts)

        # ── 提取生成的图像 ────────────────────────────────────────────────
        result_images: list[str] = []
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                result_images.append(
                    base64.b64encode(part.inline_data.data).decode("utf-8")
                )

        logger.info(f"[GeminiChat] 生成完成，共 {len(result_images)} 张图")
        return result_images
