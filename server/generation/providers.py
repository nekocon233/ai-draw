"""Provider adapters contain transport details, never task state or persistence."""
import asyncio
import base64
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional
from utils.image_mentions import resolve_image_mentions

from .contracts import GenerationParameters, GenerationProvider, MediaOutput, ProviderInput


@dataclass(frozen=True)
class ProviderRegistration:
    provider: GenerationProvider
    interrupt: Optional[Callable[[asyncio.Task], Awaitable[None]]] = None
    prepare: Optional[Callable[[str], None]] = None
    validate: Optional[Callable[[GenerationParameters], None]] = None
    enrich: Optional[Callable[[ProviderInput, Callable[[str], None]], Awaitable[GenerationParameters]]] = None


class ProviderRegistry:
    def __init__(self):
        self._providers: dict[str, ProviderRegistration] = {}

    def register(self, name: str, provider: GenerationProvider, **capabilities) -> None:
        if name in self._providers:
            raise ValueError(f"Duplicate generation provider: {name}")
        self._providers[name] = ProviderRegistration(provider, **capabilities)

    def get(self, name: str) -> ProviderRegistration:
        try:
            return self._providers[name]
        except KeyError as error:
            raise ValueError(f"未注册的生成服务: {name}") from error


class CallbackProvider:
    """Adapt ComfyUI's callback contract to one explicit result."""

    def __init__(self, method, options, kind):
        self._method = method
        self._options = options
        self._kind = kind

    async def generate(self, request: ProviderInput) -> MediaOutput:
        result = None

        def capture(content):
            nonlocal result
            result = content

        await self._method(finish_callback=capture, **self._options(request))
        if not result:
            raise RuntimeError("生成失败：未收到有效媒体数据")
        return MediaOutput(result, self._kind)


class OpenAIImageProvider:
    async def generate(self, request: ProviderInput) -> MediaOutput:
        from utils.config_loader import get_gpt_image_config
        from utils.openai_image import OpenAIImageGenerator

        cfg = get_gpt_image_config()
        if not cfg.api_key:
            raise ValueError("未配置 GPT_IMAGE_API_KEY，无法调用 gpt-image")
        client = OpenAIImageGenerator(api_key=cfg.api_key, base_url=cfg.base_url, model=cfg.model)
        images = await asyncio.to_thread(
            client.generate, resolve_image_mentions(request.parameters.prompt, request.images, "ordinal"), [image for image in request.images if image],
        )
        if not images:
            raise RuntimeError("gpt-image 未返回任何图像")
        return MediaOutput(images[0], "image")


class PixelLabProvider:
    async def generate(self, request: ProviderInput) -> MediaOutput:
        from utils.config_loader import get_pixel_lab_config
        from utils.pixel_lab import get_pixel_lab_service

        cfg = get_pixel_lab_config()
        if not cfg.api_key:
            raise ValueError("未配置 PIXEL_LAB_API_KEY，无法调用 PixelLab")
        if not request.images[0]:
            raise ValueError("像素动画工作流需要提供参考图")
        frames = await asyncio.to_thread(
            get_pixel_lab_service(cfg.api_key).animate_with_text,
            reference_image=base64.b64decode(request.images[0]),
            action=request.parameters.action, view=request.parameters.view,
            direction=request.parameters.direction, no_background=True,
        )
        if not frames:
            raise RuntimeError("PixelLab 未返回任何帧")
        return MediaOutput(frames[0], "image")


def build_provider_registry(comfyui) -> ProviderRegistry:
    """Composition root: new adapters are registered here, not in the runner."""
    from comfyui.structures.minimax_h3 import validate_minimax_h3_options
    from .qwen_image_21 import QwenImage21Provider, validate_qwen_image_21
    from .minimax_h3_ref import MiniMaxH3ReferenceProvider, validate_motion_references

    registry = ProviderRegistry()

    def prepare(workflow):
        comfyui.switch_workflow(workflow)

    def h3_options(request):
        duration, aspect_ratio = validate_minimax_h3_options(request.parameters.workflow_options)
        return {
            "prompt_text": request.parameters.prompt, "start_image_base64": request.images[0],
            "end_image_base64": request.end_image, "duration": duration, "aspect_ratio": aspect_ratio,
        }

    registry.register(
        "comfyui_minimax_h3", CallbackProvider(comfyui.generate_minimax_h3, h3_options, "video"),
        interrupt=comfyui.interrupt, prepare=prepare,
        validate=lambda params: validate_minimax_h3_options(params.workflow_options),
    )
    registry.register("openai_image", OpenAIImageProvider())
    motion_provider = MiniMaxH3ReferenceProvider(comfyui)
    registry.register(
        "comfyui_minimax_h3_ref", motion_provider,
        interrupt=comfyui.interrupt, prepare=prepare, validate=validate_motion_references,
        enrich=motion_provider.enrich,
    )
    registry.register(
        "comfyui_qwen_image_21", QwenImage21Provider(comfyui),
        interrupt=comfyui.interrupt, prepare=prepare, validate=validate_qwen_image_21,
    )
    registry.register("pixel_lab", PixelLabProvider())
    return registry
