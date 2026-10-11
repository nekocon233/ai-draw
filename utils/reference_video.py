"""Motion reference videos: safe probing, storage normalization and per-generation conforming.

Uploads are untrusted, so every ffprobe/ffmpeg call forces the sniffed demuxer and only allows local
files; a playlist or concat script renamed to .mp4 can never make ffmpeg read other files or URLs.
"""
import base64
import json
import math
import re
import subprocess
import tempfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

MOTION_VIDEO_FPS = 24
MOTION_VIDEO_MIN_SECONDS = 2.0
MOTION_VIDEO_MAX_UPLOAD_BYTES = 100 * 1024 * 1024
# Stored clips stay within the H3 reference canvas; generation scales them further to the token budget.
MOTION_VIDEO_MAX_SHORT_EDGE = 768
MOTION_VIDEO_MAX_PIXELS = 768 * 1344
MOTION_VIDEO_URL = re.compile(r"^/uploads/reference/(\d+)/([0-9a-f]{32})\.mp4$")
FFMPEG_TIMEOUT_SECONDS = 300
# PQ and HLG (e.g. iPhone HDR) look washed out unless they are tone-mapped to SDR.
HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}
ISO_BMFF_BOXES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
EBML_MAGIC = b"\x1a\x45\xdf\xa3"


class ReferenceVideoError(ValueError):
    pass


@dataclass(frozen=True)
class ReferenceVideoInfo:
    width: int  # display size, after rotation
    height: int
    duration: float
    frames: int
    color_transfer: str | None = None


def sniff_container(path) -> str:
    """Return the ffmpeg demuxer for an MP4/MOV or Matroska/WebM file, judged by its bytes only."""
    with open(path, "rb") as file:
        head = file.read(12)
    if len(head) >= 8 and head[4:8] in ISO_BMFF_BOXES:
        return "mov"
    if head[:4] == EBML_MAGIC:
        return "matroska"
    raise ReferenceVideoError("只支持 MP4、MOV 或 WebM 格式的视频")


def _run(command: list[str], label: str) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(command, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as error:
        raise ReferenceVideoError(f"{label}超时") from error
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="ignore").strip()[-400:]
        raise ReferenceVideoError(f"{label}失败：{detail or '无法解析视频'}")
    return result


def _rotation(stream: dict) -> int:
    for item in stream.get("side_data_list") or ():
        if "rotation" in item:
            return int(round(float(item["rotation"])))
    tag = (stream.get("tags") or {}).get("rotate")
    return int(round(float(tag))) if tag else 0


def probe_reference_video(path, demuxer: str | None = None) -> ReferenceVideoInfo:
    demuxer = demuxer or sniff_container(path)
    result = _run([
        "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-f", demuxer,
        "-select_streams", "v:0", "-count_packets",
        "-show_entries", "stream=width,height,nb_read_packets,avg_frame_rate,color_transfer"
        ":stream_side_data=rotation:stream_tags=rotate:format=duration",
        "-of", "json", str(path),
    ], "读取视频信息")
    try:
        data = json.loads(result.stdout.decode("utf-8", errors="ignore") or "{}")
        stream = (data.get("streams") or [None])[0]
        if not stream:
            raise ReferenceVideoError("文件中没有视频画面")
        width, height = int(stream["width"]), int(stream["height"])
        frames = int(stream.get("nb_read_packets") or 0)
        duration = float((data.get("format") or {}).get("duration") or 0)
        if duration <= 0 and frames:
            rate = Fraction(stream.get("avg_frame_rate") or "0/1")
            duration = float(frames / rate) if rate else 0.0
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as error:
        raise ReferenceVideoError("无法读取视频尺寸或时长") from error
    if width <= 0 or height <= 0 or frames <= 0 or duration <= 0:
        raise ReferenceVideoError("无法读取视频尺寸或时长")
    if abs(_rotation(stream)) % 180 == 90:
        width, height = height, width
    transfer = stream.get("color_transfer")
    return ReferenceVideoInfo(width, height, duration, frames, transfer if isinstance(transfer, str) else None)


def fit_motion_video_size(width: int, height: int) -> tuple[int, int]:
    """Downscale only, to the H3 reference canvas (768 short edge, 768x1344 area); H.264 needs even sizes."""
    scale = min(1.0, MOTION_VIDEO_MAX_SHORT_EDGE / min(width, height), math.sqrt(MOTION_VIDEO_MAX_PIXELS / (width * height)))
    return max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)


def _tonemap_filters(transfer: str | None) -> list[str]:
    if transfer not in HDR_TRANSFERS:
        return []
    return ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709",
            "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv"]


def normalize_motion_video(source, target, max_seconds: float) -> tuple[ReferenceVideoInfo, ReferenceVideoInfo]:
    """Store the first `max_seconds` as silent constant-24fps H.264; returns (source, stored) info."""
    demuxer = sniff_container(source)
    original = probe_reference_video(source, demuxer)
    if original.duration < MOTION_VIDEO_MIN_SECONDS:
        raise ReferenceVideoError(f"动作视频至少需要 {MOTION_VIDEO_MIN_SECONDS:g} 秒")
    width, height = fit_motion_video_size(original.width, original.height)
    filters = [*_tonemap_filters(original.color_transfer), f"fps={MOTION_VIDEO_FPS}",
               f"scale={width}:{height}:flags=lanczos", "setsar=1", "format=yuv420p"]
    _run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file", "-f", demuxer, "-i", str(source),
        "-t", f"{max_seconds:.3f}", "-map", "0:v:0", "-vf", ",".join(filters),
        "-an", "-sn", "-dn", "-map_metadata", "-1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-movflags", "+faststart", "-f", "mp4", str(target),
    ], "视频转码")
    stored = probe_reference_video(target, "mov")
    if stored.duration < MOTION_VIDEO_MIN_SECONDS - 0.05:
        raise ReferenceVideoError(f"动作视频至少需要 {MOTION_VIDEO_MIN_SECONDS:g} 秒")
    return original, stored


def conform_reference_video(source, target, width: int, height: int, frames: int) -> None:
    """Exactly `frames` frames at width x height: longer clips are cut, shorter ones hold their last frame."""
    info = probe_reference_video(source, "mov")
    filters = [f"scale={width}:{height}:flags=lanczos", "setsar=1"]
    if frames > info.frames:
        filters.append(f"tpad=stop_mode=clone:stop={frames - info.frames}")
    filters.append("format=yuv420p")
    _run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file", "-f", "mov", "-i", str(source),
        "-map", "0:v:0", "-vf", ",".join(filters), "-frames:v", str(frames), "-an", "-sn", "-dn",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-f", "mp4", str(target),
    ], "参考视频预处理")


def sample_reference_frames(path, count: int = 8, max_edge: int = 768) -> list[tuple[float, str]]:
    """Evenly spaced JPEG frames (seconds, base64) covering the whole stored clip, for visual analysis."""
    info = probe_reference_video(path, "mov")
    count = max(1, min(count, info.frames))
    indexes = sorted({round(i * (info.frames - 1) / max(1, count - 1)) for i in range(count)})
    selector = "+".join(f"eq(n\\,{index})" for index in indexes)
    scale = f"scale='min({max_edge},iw)':'min({max_edge},ih)':force_original_aspect_ratio=decrease"
    with tempfile.TemporaryDirectory(prefix="motion_frames_") as directory:
        pattern = str(Path(directory) / "frame_%03d.jpg")
        _run([
            "ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file", "-f", "mov", "-i", str(path),
            "-map", "0:v:0", "-vf", f"select='{selector}',{scale}", "-fps_mode", "passthrough", "-q:v", "3", pattern,
        ], "视频抽帧")
        files = sorted(Path(directory).glob("frame_*.jpg"))
        if not files:
            raise ReferenceVideoError("视频抽帧失败：没有得到画面")
        return [(index / MOTION_VIDEO_FPS, base64.b64encode(file.read_bytes()).decode("ascii"))
                for index, file in zip(indexes, files)]


def motion_video_owner(value) -> int | None:
    """User id encoded in a stored motion video URL, or None when the URL is not exactly that form."""
    match = MOTION_VIDEO_URL.match(value) if isinstance(value, str) else None
    return int(match.group(1)) if match else None


def resolve_reference_video(value: str, upload_dir, label: str = "动作视频") -> Path:
    if motion_video_owner(value) is None:
        raise ValueError(f"{label}地址无效，请重新上传")
    root = Path(upload_dir).resolve()
    path = (root / value.removeprefix("/uploads/")).resolve()
    if root not in path.parents:
        raise ValueError(f"{label}地址无效，请重新上传")
    if not path.is_file():
        raise ValueError(f"{label}文件不存在，请重新上传")
    return path
