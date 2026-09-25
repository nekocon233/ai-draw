"""Shared text and vision client for the configured Codex subscription proxy."""
import base64
from io import BytesIO
from typing import Sequence

from openai import OpenAI
from PIL import Image

from utils.config_loader import get_config


class InvalidImageError(ValueError):
    pass


def image_data_url(value: str) -> str:
    """Normalize browser data URLs and legacy raw base64; never fetch remote URLs."""
    if not isinstance(value, str) or not value.strip():
        raise InvalidImageError("请提供有效的图片数据")
    value = value.strip()
    if value.startswith("data:"):
        header, separator, encoded = value.partition(",")
        if not separator or not header.startswith("data:image/") or not header.endswith(";base64"):
            raise InvalidImageError("图片必须使用 base64 data URL")
    else:
        encoded = value
    if len(encoded) > 4 * ((20 * 1024 * 1024 + 2) // 3):
        raise InvalidImageError("图片数据不能超过 20MB")
    try:
        data = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(data)) as image:
            mime = Image.MIME.get(image.format)
            image.verify()
        if mime not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
            raise ValueError("unsupported image format")
    except Exception as error:
        raise InvalidImageError("图片数据无效，仅支持 PNG、JPEG、WEBP 或 GIF") from error
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


class LanguageModel:
    def __init__(self):
        config = get_config()
        self.api_key = config.gpt_image.api_key
        self.base_url = config.gpt_image.base_url
        self.model = config.codex_llm.model
        self.client = OpenAI(api_key=self.api_key or "not-configured", base_url=self.base_url, timeout=120.0)

    def complete(self, prompt: str, *, system: str | None = None, images: Sequence[str] = (), **options) -> str:
        if not self.api_key:
            raise ValueError("未配置 LLM 服务密钥；Codex 模式复用 GPT_IMAGE_API_KEY")
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        content = prompt
        if images:
            content = [{"type": "text", "text": prompt}] + [
                {"type": "image_url", "image_url": {"url": image_data_url(image)}} for image in images
            ]
        messages.append({"role": "user", "content": content})
        response = self.client.chat.completions.create(model=self.model, messages=messages, **options)
        text = response.choices[0].message.content if response.choices else None
        if not isinstance(text, str) or not text.strip():
            raise ValueError("LLM 服务未返回有效文字")
        return text.strip()
