"""One catalog drives discovery, provider resolution and input capabilities."""
from copy import deepcopy
from utils.image_mentions import validate_image_mentions

from .contracts import GenerationParameters
from .providers import ProviderRegistry
from .presets import validate_prompt_preset


class WorkflowCatalog:
    def __init__(self, metadata: dict, providers: ProviderRegistry):
        self._metadata = deepcopy(metadata)
        self._providers = providers
        for name in self._metadata:
            self.registration(name)  # Fail early on configuration mistakes.

    def metadata(self, workflow: str) -> dict:
        if workflow not in self._metadata:
            raise ValueError(f"未知工作流: {workflow}")
        return deepcopy(self._metadata[workflow])

    def registration(self, workflow: str):
        metadata = self.metadata(workflow)
        provider = metadata.get("provider")
        if not provider:
            raise ValueError(f"工作流 {workflow} 未配置 provider")
        return self._providers.get(provider)

    def describe(self, workflow: str) -> dict:
        metadata = self.metadata(workflow)
        result = {
            name: metadata.get(name, False) for name in (
                "requires_image", "requires_end_image", "supports_optional_keyframes",
                "supports_original_size", "supports_multi_image",
                "supports_motion_reference",
            )
        }
        result.update(
            key=workflow, label=metadata.get("label", workflow),
            description=metadata.get("description", ""),
            output_type=metadata.get("output_type", "image"),
            category=metadata.get("category"), method=metadata.get("method"),
            parameters=metadata.get("parameters", []),
            max_count=self.max_count(workflow),
            max_motion_reference_images=metadata.get("max_motion_reference_images", 0),
            reference_image_label=metadata.get("reference_image_label", "参考图片"),
            reference_image_description=metadata.get("reference_image_description"),
            method_group=metadata.get("method_group"),
            text_workflow=metadata.get("text_workflow"),
            image_workflow=metadata.get("image_workflow"),
            default_prompt_preset_id=metadata.get("default_prompt_preset_id"),
            # History stores the adapter file ID; this lets the UI show the registered name instead.
            lora_labels={item["name"].removesuffix(".safetensors"): item["label"] for item in metadata.get("lora_models", [])},
        )
        return result

    def list(self) -> list[dict]:
        return [self.describe(workflow) for workflow in self._metadata]

    def max_count(self, workflow: str) -> int:
        metadata = self.metadata(workflow)
        if metadata.get("output_type") == "video":
            return 1
        parameter = next((item for item in metadata.get("parameters", []) if item["name"] == "count"), None)
        return int(parameter.get("max", 8)) if parameter else 1

    def validate(self, parameters: GenerationParameters) -> None:
        metadata = self.metadata(parameters.workflow)
        validate_prompt_preset(parameters, metadata)
        parameters = parameters.for_provider()
        label = metadata.get("label", parameters.workflow)
        if parameters.motion_reference_images and not metadata.get("supports_motion_reference"):
            raise ValueError(f"{label} 不支持动作参考图")
        if not 1 <= parameters.count <= self.max_count(parameters.workflow):
            raise ValueError(f"{label} 每次支持生成 1 到 {self.max_count(parameters.workflow)} 个结果")
        if metadata.get("requires_image") and not parameters.reference_image:
            raise ValueError(f"{label} 需要提供参考图")
        if metadata.get("requires_end_image") and not parameters.reference_image_end:
            raise ValueError(f"{label} 需要提供尾帧参考图")
        if metadata.get("supports_multi_image") and metadata.get("output_type") != "video":
            validate_image_mentions(parameters.prompt, [parameters.reference_image, parameters.reference_image_2, parameters.reference_image_3])
        validator = self.registration(parameters.workflow).validate
        if validator:
            validator(parameters)
