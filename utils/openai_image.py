"""
OpenAI 兼容 API 图像生成 / 编辑

通过第三方兼容 API（如 UniAPI）调用 OpenAI 图像模型（gpt-image 系列），
支持多张参考图的图像编辑（images.edit），无参考图时回退到纯文生图（images.generate）。
"""
import base64
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class OpenAIImageGenerator:
    """OpenAI 兼容 API 图像生成封装（openai SDK）"""

    def __init__(self, api_key: str, base_url: str, model: str):
        # 延迟导入，避免启动时 import 失败
        from openai import OpenAI
        self.client = OpenAI(base_url=base_url or None, api_key=api_key)
        self.model = model

    @staticmethod
    def _strip_data_url(b64: str) -> str:
        """去除 data URL 前缀，返回纯 base64"""
        if not b64:
            return ""
        return b64.split(",", 1)[1] if b64.startswith("data:") else b64

    def generate(
        self,
        prompt: str,
        input_images: Optional[list[str]] = None,
    ) -> list[str]:
        """
        生成或编辑图像。

        Args:
            prompt: 提示词
            input_images: 参考图 base64 列表（可含 data URL 前缀）。非空走 images.edit。

        Returns:
            生成图像的 base64 字符串列表（不含 data URL 前缀）
        """
        images = [img for img in (input_images or []) if img]

        if images:
            # 图生图：images.edit，支持多张参考图（gpt-image 多图编辑 / 合成）
            # 每个文件为 (filename, fileobj, mime) 元组，组成列表传入 image
            files = [
                (f"img_{idx}.png", io.BytesIO(base64.b64decode(self._strip_data_url(img))), "image/png")
                for idx, img in enumerate(images)
            ]
            logger.info(f"[OpenAIImage] images.edit，参考图 {len(files)} 张，model={self.model}")
            result = self.client.images.edit(
                model=self.model,
                image=files,
                prompt=prompt,
            )
        else:
            # 无参考图：纯文生图兜底
            logger.info(f"[OpenAIImage] images.generate（无参考图），model={self.model}")
            result = self.client.images.generate(
                model=self.model,
                prompt=prompt,
            )

        out: list[str] = []
        for d in result.data:
            b64 = getattr(d, "b64_json", None)
            if b64:
                out.append(b64)
        logger.info(f"[OpenAIImage] 生成完成，共 {len(out)} 张图")
        return out
