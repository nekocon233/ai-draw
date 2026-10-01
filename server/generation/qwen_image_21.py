"""Unified Qwen-Image-2.1 provider; lifecycle and storage stay in the coordinator."""
from comfyui.structures.qwen_image_21 import parse_qwen_loras, qwen_options, validate_qwen_size
from comfyui.structures.seed import QWEN_SEED_OPTION, fixed_seed
from server.lora_catalog import installed_lora_names
from utils.config_loader import get_config
from utils.image_mentions import resolve_image_mentions

from .contracts import GenerationParameters, MediaOutput, ProviderInput


def validate_qwen_image_21(parameters: GenerationParameters) -> None:
    qwen_options(parameters.workflow_options)
    fixed_seed(parameters.workflow_options, QWEN_SEED_OPTION, parameters.count)
    editing = parameters.workflow == "qwen_image_21_i2i"
    if not editing and any((parameters.reference_image, parameters.reference_image_2, parameters.reference_image_3)):
        raise ValueError("请使用 Qwen-Image-2.1 图生图工作流处理参考图")
    if not editing or not parameters.use_original_size:
        validate_qwen_size(parameters.width, parameters.height)
    metadata = get_config().workflow_defaults.workflow_metadata.get(parameters.workflow, {})
    compatible = {item["name"] for item in metadata.get("lora_models", [])}
    for name, _ in parse_qwen_loras(parameters.lora_prompt):
        if name not in compatible:
            raise ValueError(f"LoRA 未登记为兼容 Qwen-Image-2.1：{name}")


class QwenImage21Provider:
    def __init__(self, comfyui, seed: int | None = None):
        self.comfyui = comfyui
        self.seed = seed

    async def generate(self, request: ProviderInput) -> MediaOutput:
        params = request.parameters
        loras = parse_qwen_loras(params.lora_prompt)
        if loras:
            installed = installed_lora_names(await self.comfyui.get_object_info("LoraLoaderModelOnly"))
            for name, _ in loras:
                if name not in installed:
                    raise ValueError(f"未安装 Qwen-Image-2.1 LoRA：{name}")
        steps, reference_resolution = qwen_options(params.workflow_options)
        result = None

        def capture(content):
            nonlocal result
            result = content

        await self.comfyui.generate_qwen_image_21(
            finish_callback=capture, prompt_text=resolve_image_mentions(params.prompt, request.images, "qwen"),
            images=[image for image in request.images if image], loras=loras,
            width=params.width or 1024, height=params.height or 1024,
            use_original_size=params.use_original_size, steps=steps,
            reference_resolution=reference_resolution,
            seed=request.seed if request.seed is not None else self.seed,
        )
        if not result:
            raise RuntimeError("Qwen-Image-2.1 未返回图片")
        return MediaOutput(result, "image")
