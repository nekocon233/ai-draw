def extract_upscale_model_options(payload: dict) -> list[str]:
    """兼容 ComfyUI 新旧 object_info 下拉选项结构。"""
    try:
        model_field = payload["UpscaleModelLoader"]["input"]["required"]["model_name"]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(model_field, list) or not model_field:
        return []
    if isinstance(model_field[0], list):
        values = model_field[0]
    elif len(model_field) > 1 and isinstance(model_field[1], dict):
        values = model_field[1].get("options", [])
    else:
        values = []
    return [str(value) for value in values]
