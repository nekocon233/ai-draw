"""Preset scope and reference-slot validation, including video end frames."""
from utils.image_mentions import IMAGE_MENTION, validate_image_mentions

from .contracts import GenerationParameters


def validate_prompt_preset(parameters: GenerationParameters, metadata: dict) -> None:
    preset = parameters.prompt_preset
    if not preset:
        return
    output_type = preset.get("output_type", "image")
    if output_type != metadata.get("output_type", "image"):
        raise ValueError("提示词预设与当前生成方式不匹配，请重新选择预设")
    if preset.get("workflow_ids") is not None and parameters.workflow not in preset["workflow_ids"]:
        raise ValueError("此预设不适用于当前生成方式，请重新选择预设")
    needs_motion = preset.get("requires_motion_reference", False)
    if needs_motion and not metadata.get("supports_motion_reference"):
        raise ValueError("此预设需要支持动作参考图的生成方式")

    slots = [image.get("slot") if image.get("slot") is not None else index
             for index, image in enumerate(preset.get("images") or [], 1)]
    slots.extend(int(match.group(1) or match.group(2))
                 for match in IMAGE_MENTION.finditer(preset.get("prompt", "")))
    if any(slot != "end" and (type(slot) is not int or not 1 <= slot <= 3) for slot in slots):
        raise ValueError("预设引用的图片位置无效")
    reference_count = max((slot for slot in slots if slot != "end"), default=0)
    needs_end = "end" in slots
    references = [parameters.reference_image, parameters.reference_image_2, parameters.reference_image_3]

    if output_type == "image":
        if (reference_count or needs_end) and not metadata.get("supports_multi_image"):
            raise ValueError("当前工作流不支持引用参考图")
        validate_image_mentions(preset.get("prompt", ""), references)
    else:
        capacity = 3 if metadata.get("supports_multi_image") else int(bool(
            metadata.get("requires_image") or metadata.get("supports_optional_keyframes")))
        if reference_count > capacity:
            raise ValueError("当前工作流不支持预设要求的起始参考图")
    if needs_end and not (metadata.get("requires_end_image") or metadata.get("supports_optional_keyframes")):
        raise ValueError("当前工作流不支持结束帧")
    for index in range(reference_count):
        if not references[index]:
            label = ("原始画面" if needs_motion else "开始帧") if output_type == "video" and index == 0 else f"参考图 {index + 1}"
            if needs_motion and index == 0:
                # Motion presets name their subject image, e.g. 原始画面 or 主体图.
                label = ((preset.get("images") or [{}])[0].get("label") or label)
            raise ValueError(f"预设需要提供{label}")
    if needs_end and not parameters.reference_image_end:
        raise ValueError("预设需要提供结束帧")
    if needs_motion and not parameters.motion_reference_images:
        raise ValueError("预设需要提供动作参考图")
