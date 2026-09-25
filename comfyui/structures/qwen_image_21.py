"""Validated parameters and native LoRA nodes for the adapted Qwen 2.1 graphs."""
import math
import re


STEPS = (20, 25, 40, 50)
REFERENCE_RESOLUTIONS = (512, 768, 1024, 1536, 2048)
MAX_PIXELS = 3072 * 1536
LORA_TAG = re.compile(r"<lora:([^<>:]+):([+-]?(?:\d+(?:\.\d*)?|\.\d+))>")


def parse_qwen_loras(value: str) -> list[tuple[str, float]]:
    if len(value) > 255:
        raise ValueError("LoRA 设置过长，请减少 LoRA 数量")
    matches = list(LORA_TAG.finditer(value))
    if LORA_TAG.sub("", value).strip():
        raise ValueError("LoRA 格式应为 <lora:模型名:0.8>")
    result = []
    for match in matches:
        name, strength = match.group(1), float(match.group(2))
        if not name.strip() or not math.isfinite(strength) or not 0 <= strength <= 1:
            raise ValueError("Qwen-Image-2.1 LoRA 强度应在 0 到 1 之间")
        result.append((name.removesuffix(".safetensors") + ".safetensors", strength))
    return result


def qwen_options(options: dict | None) -> tuple[int, int]:
    options = options or {}
    values = []
    for key, default, allowed in (
        ("qwen_steps", 40, STEPS),
        ("qwen_reference_resolution", 1024, REFERENCE_RESOLUTIONS),
    ):
        value = options.get(key, default)
        if isinstance(value, bool) or str(value) not in {str(item) for item in allowed}:
            raise ValueError(f"无效的 Qwen-Image-2.1 参数：{key}")
        values.append(int(value))
    return tuple(values)


def validate_qwen_size(width: int | None, height: int | None) -> tuple[int, int]:
    width = 1024 if width is None else width
    height = 1024 if height is None else height
    if any(type(value) is not int or not 256 <= value <= 3072 or value % 32 for value in (width, height)):
        raise ValueError("Qwen-Image-2.1 宽高需为 256–3072 之间的 32 的倍数")
    if width * height > MAX_PIXELS:
        raise ValueError("Qwen-Image-2.1 总像素不能超过 3072×1536，请降低宽度或高度")
    return width, height


def attach_qwen_loras(graph: dict, loras: list[tuple[str, float]]) -> None:
    """Replace the template adapters with the request's model-only LoRA selection."""
    # The JSON templates include a visible adapter for direct ComfyUI use.
    # An empty application selection must remove it, and a non-empty selection
    # must replace it rather than stack the same adapter twice.
    for node_id, node in list(graph.items()):
        if (node.get("class_type") == "LoraLoaderModelOnly"
                and node.get("_meta", {}).get("title", "").startswith("qwen_lora_")):
            del graph[node_id]
    model = ["1", 0]
    for index, (name, strength) in enumerate(loras):
        node_id = str(100 + index)
        graph[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": model, "lora_name": name, "strength_model": strength},
            "_meta": {"title": f"qwen_lora_{index + 1}"},
        }
        model = [node_id, 0]
    # The edit cache belongs after LoRA patching, and each request gets a fresh graph.
    if "9" in graph:
        graph["9"]["inputs"]["model"] = model
    else:
        graph["6"]["inputs"]["model"] = model
