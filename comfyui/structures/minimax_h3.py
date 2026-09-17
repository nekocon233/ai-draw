import math


MINIMAX_H3_RESOLUTIONS = {
    "21:9": (1536, 672),
    "16:9": (1344, 768),
    "4:3": (1024, 768),
    "1:1": (768, 768),
    "3:4": (768, 1024),
    "9:16": (768, 1344),
}

MINIMAX_H3_CANVAS_MULTIPLE = 32
MINIMAX_H3_BASE_SHORT_EDGE = 768
MINIMAX_H3_MAX_PIXELS = 768 * 1344


def get_minimax_h3_resolution(
    aspect_ratio: str,
    source_sizes: list[tuple[int, int]] | None = None,
) -> tuple[int, int]:
    if aspect_ratio == "auto":
        if not source_sizes:
            return MINIMAX_H3_RESOLUTIONS["16:9"]

        resolutions = {_adapt_minimax_h3_canvas(*size) for size in source_sizes}
        if len(resolutions) > 1:
            raise ValueError(
                "MiniMax H3 首尾关键帧比例不一致；请使用相同比例的图片，或手动画幅"
            )
        return resolutions.pop()

    try:
        return MINIMAX_H3_RESOLUTIONS[aspect_ratio]
    except KeyError as error:
        raise ValueError(f"MiniMax H3 不支持画幅: {aspect_ratio}") from error


def _adapt_minimax_h3_canvas(width: int, height: int) -> tuple[int, int]:
    if width <= 0 or height <= 0:
        raise ValueError("MiniMax H3 关键帧尺寸无效")

    ratio = width / height
    if ratio >= 1:
        canvas_width = MINIMAX_H3_BASE_SHORT_EDGE * ratio
        canvas_height = MINIMAX_H3_BASE_SHORT_EDGE
    else:
        canvas_width = MINIMAX_H3_BASE_SHORT_EDGE
        canvas_height = MINIMAX_H3_BASE_SHORT_EDGE / ratio

    if canvas_width * canvas_height > MINIMAX_H3_MAX_PIXELS:
        scale = math.sqrt(MINIMAX_H3_MAX_PIXELS / (canvas_width * canvas_height))
        canvas_width *= scale
        canvas_height *= scale

    return (
        max(
            MINIMAX_H3_CANVAS_MULTIPLE,
            round(canvas_width / MINIMAX_H3_CANVAS_MULTIPLE) * MINIMAX_H3_CANVAS_MULTIPLE,
        ),
        max(
            MINIMAX_H3_CANVAS_MULTIPLE,
            round(canvas_height / MINIMAX_H3_CANVAS_MULTIPLE) * MINIMAX_H3_CANVAS_MULTIPLE,
        ),
    )


def get_minimax_h3_frame_count(duration: float) -> int:
    duration = float(duration)
    if duration < 4 or duration > 15:
        raise ValueError("MiniMax H3 时长必须在 4 到 15 秒之间")
    frame_count = max(5, round(duration * 24))
    while frame_count % 17 != 5:
        frame_count += 1
    return frame_count


def validate_minimax_h3_options(options: dict | None) -> tuple[float, str]:
    options = options or {}
    allowed = {"h3_duration", "h3_aspect_ratio"}
    unknown = set(options) - allowed
    if unknown:
        raise ValueError(f"MiniMax H3 包含未知参数: {', '.join(sorted(unknown))}")
    duration = float(options.get("h3_duration", 5))
    aspect_ratio = str(options.get("h3_aspect_ratio", "auto"))
    get_minimax_h3_frame_count(duration)
    get_minimax_h3_resolution(aspect_ratio)
    return duration, aspect_ratio


def remove_nodes_by_title(workflow, titles: list[str]) -> None:
    """删除可选节点，并清理所有指向这些节点的连接。"""
    node_ids = {
        node_id
        for node_id, node in workflow.items()
        if node.get("_meta", {}).get("title") in titles
    }
    for node_id in node_ids:
        del workflow[node_id]
    node_id_strings = {str(node_id) for node_id in node_ids}
    for node in workflow.values():
        inputs = node.get("inputs", {})
        for input_name, value in list(inputs.items()):
            if isinstance(value, list) and value and str(value[0]) in node_id_strings:
                del inputs[input_name]
