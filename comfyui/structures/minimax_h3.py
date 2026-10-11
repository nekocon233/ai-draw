import math

from comfyui.structures.seed import H3_SEED_OPTION, fixed_seed


MINIMAX_H3_RESOLUTIONS = {
    "21:9": (1536, 672),
    "16:9": (1344, 768),
    "4:3": (1024, 768),
    "1:1": (768, 768),
    "3:4": (768, 1024),
    "9:16": (768, 1344),
}

MINIMAX_H3_AUDIO_MODES = ("silent", "native")

MINIMAX_H3_CANVAS_MULTIPLE = 32
MINIMAX_H3_BASE_SHORT_EDGE = 768
MINIMAX_H3_MAX_PIXELS = 768 * 1344
MINIMAX_H3_FPS = 24
MINIMAX_H3_AUDIO_LATENT_FPS = 40

# ComfyUI sizes model offloading for the target latent only, so reference rows are unaccounted VRAM.
# Packed DiT rows that still sampled on the RTX 5070 Ti 16 GB; see docs/minimax_h3_reference.md.
MINIMAX_H3_TOKEN_BUDGET = 50_000
# Prompt text, reference labels and video timestamps in the Qwen presentation.
MINIMAX_H3_PROMPT_TOKEN_RESERVE = 3_072
MINIMAX_H3_REFERENCE_VIDEO_MIN_SHORT_EDGE = 256


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


def get_minimax_h3_video_frame_count(source_frames: int) -> int:
    """A motion video sets the output length: at least four seconds, aligned up to the 17k+5 grid."""
    return get_minimax_h3_frame_count(min(15.0, max(4.0, source_frames / MINIMAX_H3_FPS)))


def minimax_h3_latent_frames(frame_count: int) -> int:
    return 2 if frame_count <= 5 else ((frame_count - 5) // 17) * 5 + 2


def minimax_h3_frame_tokens(width: int, height: int) -> int:
    """DiT rows per latent frame: a 16x VAE latent split into 2x2 patches."""
    return (width // MINIMAX_H3_CANVAS_MULTIPLE) * (height // MINIMAX_H3_CANVAS_MULTIPLE)


def minimax_h3_match_image_size(size: tuple[int, int], canvas: tuple[int, int]) -> tuple[int, int]:
    """`ref_image_size: match` scales a reference image down (never up) to the generation's pixel area."""
    width, height = size
    scale = min(1.0, math.sqrt((canvas[0] * canvas[1]) / (width * height)))
    return tuple(
        max(MINIMAX_H3_CANVAS_MULTIPLE, round(value * scale / MINIMAX_H3_CANVAS_MULTIPLE) * MINIMAX_H3_CANVAS_MULTIPLE)
        for value in (width, height)
    )


def minimax_h3_sequence_tokens(
    canvas: tuple[int, int], frame_count: int, image_sizes=(), video_size: tuple[int, int] | None = None,
) -> int:
    """Rows of the packed sequence, mirroring ComfyUI's PackedLayout for Ref2VA.

    Text holds the prompt plus every reference's Qwen vision tokens; the DiT then adds reference
    image and video rows, stereo audio rows and the target video. A reference video is assumed to be
    conformed to exactly `frame_count` frames, so its latent length equals the target's.
    """
    latent_frames = minimax_h3_latent_frames(frame_count)
    audio_rows = 2 * round(frame_count / MINIMAX_H3_FPS * MINIMAX_H3_AUDIO_LATENT_FPS)
    tokens = MINIMAX_H3_PROMPT_TOKEN_RESERVE + audio_rows + latent_frames * minimax_h3_frame_tokens(*canvas)
    for size in image_sizes:
        tokens += 2 * minimax_h3_frame_tokens(*minimax_h3_match_image_size(size, canvas))
    if video_size:
        # Qwen sees the clip at 2 fps in blocks of two frames.
        qwen_blocks = math.ceil(math.ceil(frame_count / (MINIMAX_H3_FPS // 2)) / 2)
        tokens += (latent_frames + qwen_blocks) * minimax_h3_frame_tokens(*video_size)
    return tokens


def _reference_video_cap(width: int, height: int) -> tuple[int, int]:
    """The node's own canvas for a reference video: adapted, or the source size when smaller."""
    cap = _adapt_minimax_h3_canvas(width, height)
    if width * height < cap[0] * cap[1]:
        cap = tuple(
            max(MINIMAX_H3_CANVAS_MULTIPLE, round(value / MINIMAX_H3_CANVAS_MULTIPLE) * MINIMAX_H3_CANVAS_MULTIPLE)
            for value in (width, height)
        )
    return cap


def plan_minimax_h3_reference_video(
    canvas: tuple[int, int], frame_count: int, video_size: tuple[int, int], image_sizes=(),
) -> tuple[int, int]:
    """Largest /32 size with the clip's aspect that keeps the packed sequence within the GPU budget."""
    cap_width, cap_height = _reference_video_cap(*video_size)
    ratio = video_size[0] / video_size[1]
    short = min(cap_width, cap_height)
    floor = min(short, MINIMAX_H3_REFERENCE_VIDEO_MIN_SHORT_EDGE)
    while short >= floor:
        long = max(MINIMAX_H3_CANVAS_MULTIPLE, round(short * max(ratio, 1 / ratio) / MINIMAX_H3_CANVAS_MULTIPLE) * MINIMAX_H3_CANVAS_MULTIPLE)
        size = (min(long, cap_width), min(short, cap_height)) if ratio >= 1 else (min(short, cap_width), min(long, cap_height))
        if minimax_h3_sequence_tokens(canvas, frame_count, image_sizes, size) <= MINIMAX_H3_TOKEN_BUDGET:
            return size
        short -= MINIMAX_H3_CANVAS_MULTIPLE
    raise ValueError("动作视频超出显卡可处理的长度，请换用更短的视频后重试")


def validate_minimax_h3_options(options: dict | None) -> tuple[float, str, bool]:
    """返回时长、画幅和是否保留音轨；未设置声音（含旧消息）时默认无声。"""
    options = options or {}
    allowed = {"h3_duration", "h3_aspect_ratio", "h3_audio", H3_SEED_OPTION}
    unknown = set(options) - allowed
    if unknown:
        raise ValueError(f"MiniMax H3 包含未知参数: {', '.join(sorted(unknown))}")
    duration = float(options.get("h3_duration", 5))
    aspect_ratio = str(options.get("h3_aspect_ratio", "auto"))
    audio = str(options.get("h3_audio", "silent"))
    if audio not in MINIMAX_H3_AUDIO_MODES:
        raise ValueError(f"MiniMax H3 不支持声音选项: {audio}")
    get_minimax_h3_frame_count(duration)
    get_minimax_h3_resolution(aspect_ratio)
    fixed_seed(options, H3_SEED_OPTION)
    return duration, aspect_ratio, audio == "native"


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
