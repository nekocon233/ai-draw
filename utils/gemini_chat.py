"""
Google Gemini 多轮对话图像生成

使用 Nano Banana API Key 调用 Gemini API 实现携带历史的多轮图像生成。
"""
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class GeminiChat:
    """Gemini 多轮对话图像生成封装"""

    def __init__(self, api_key: str, model_name: str = "gemini-3-pro-image-preview"):
        self.api_key = api_key
        self.model_name = model_name

    def generate(
        self,
        current_prompt: str,
        current_images: Optional[list[str]] = None,
        history: Optional[list[dict]] = None,
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

        Returns:
            生成图像的 base64 字符串列表（不含 data URL 前缀）
        """
        import google.generativeai as genai  # 延迟导入，避免启动时 import 失败
        import google.ai.generativelanguage as glm

        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(model_name=self.model_name)

        # ── 构建历史对话内容 ──────────────────────────────────────────────
        chat_history = []
        for turn in (history or []):
            user_parts: list = []

            # 用户上传的参考图
            for img_b64 in (turn.get("images") or []):
                if img_b64:
                    try:
                        user_parts.append({
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": img_b64,
                            }
                        })
                    except Exception as e:
                        logger.warning(f"[GeminiChat] 历史参考图处理失败: {e}")

            # 用户提示词
            if turn.get("prompt"):
                user_parts.append(turn["prompt"])

            if user_parts:
                chat_history.append({"role": "user", "parts": user_parts})

            # Model 回复（仅包含生成图片）
            # Gemini 3 的 thought_signature 在历史重建时无法获取，
            # 使用官方占位符 "skip_thought_signature_validator" 跳过校验
            # 必须用 glm.Part proto 类型，SDK 无法解析含 thought_signature 的普通 dict
            model_parts: list = []
            for img_b64 in (turn.get("result_images") or []):
                if img_b64:
                    try:
                        model_parts.append(
                            glm.Part(
                                inline_data=glm.Blob(
                                    mime_type="image/png",
                                    data=base64.b64decode(img_b64),
                                ),
                                thought_signature=b"skip_thought_signature_validator",
                            )
                        )
                    except Exception as e:
                        logger.warning(f"[GeminiChat] 历史生成图处理失败: {e}")
            if model_parts:
                chat_history.append({"role": "model", "parts": model_parts})

        # ── 构建当前用户消息 ──────────────────────────────────────────────
        current_parts: list = []
        for img_b64 in (current_images or []):
            if img_b64:
                try:
                    current_parts.append({
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": img_b64,
                        }
                    })
                except Exception as e:
                    logger.warning(f"[GeminiChat] 当前图片处理失败: {e}")
        if current_prompt:
            current_parts.append(current_prompt)

        logger.info(
            f"[GeminiChat] 发送请求，历史轮次: {len(history or [])}，"
            f"历史图片对: {sum(len(t.get('result_images') or []) for t in (history or []))}，"
            f"当前图片: {len(current_images or [])}"
        )

        # ── 调用 Gemini API ───────────────────────────────────────────────
        # 不传 thinking_config（旧版 SDK 不支持），改用官方占位符跳过签名校验
        generation_config = {
            "response_modalities": ["IMAGE", "TEXT"],
        }

        chat = model.start_chat(history=chat_history)
        response = chat.send_message(
            current_parts,
            generation_config=generation_config,
        )

        # ── 提取生成的图像 ────────────────────────────────────────────────
        result_images: list[str] = []
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                if part.inline_data.mime_type.startswith("image/"):
                    result_images.append(
                        base64.b64encode(part.inline_data.data).decode("utf-8")
                    )

        logger.info(f"[GeminiChat] 生成完成，共 {len(result_images)} 张图")
        return result_images
