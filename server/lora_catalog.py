"""Intersect explicitly compatible workflow adapters with ComfyUI's installed files."""

# Strength preselected when a LoRA is picked, unless its `lora_models` entry sets `default_strength`.
DEFAULT_LORA_STRENGTH = 0.8


def installed_lora_names(payload: dict) -> set[str]:
    try:
        node = payload.get("LoraLoaderModelOnly", payload)
        field = node["input"]["required"]["lora_name"]
        if isinstance(field[0], list):
            names = field[0]
        else:
            names = field[1]["options"]
        if not isinstance(names, list):
            raise TypeError("Expected a list of LoRA filenames")
        return {name for name in names if isinstance(name, str)}
    except (KeyError, IndexError, TypeError, AttributeError) as error:
        raise ValueError("无法读取 ComfyUI 的 LoRA 列表") from error


def workflow_lora_options(metadata: dict, payload: dict) -> list[dict]:
    installed = installed_lora_names(payload)
    # Exact relative paths avoid ambiguous basenames and cross-model adapters.
    return [
        {
            "value": item["name"].removesuffix(".safetensors"),
            "label": item["label"],
            "default_strength": float(item.get("default_strength", DEFAULT_LORA_STRENGTH)),
        }
        for item in metadata.get("lora_models", [])
        if item["name"] in installed
    ]
