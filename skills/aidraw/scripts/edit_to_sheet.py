#!/usr/bin/env python3
"""The user's own edit in ai-draw (编辑帧 → 导出精灵图 or 原始帧 ZIP) → the same kind of sprite sheet that
video_to_sheet.py delivers: aligned with the static sprite, packed without blank cells, registered with endFrame.

The user's frames stay as they are (order, duplicates, painted fixes). This only aligns, scales and packs them and
does the lossless clean-up every cutout gets (faint specks, white fringes); frames still on their backdrop get the
project's cutout algorithm.

Exports from ai-draw carry their layout as JSON under "ai-draw" (a PNG text chunk, or meta.json in a ZIP): frame
count, grid, frame size, fps and the source frames. Older exports without it are read by finding the grid (the
source video's frame size when it divides the sheet, else the gaps in the alpha channel) and, with --video, by
matching every frame to the clip to recover the frame rate.

Prints one JSON object; `warnings` (duplicate frames, a jump at the loop seam, guesses) are for the agent to report
in the chat, not in the ai-draw session.
"""
import argparse
import json
import math
import statistics
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutout_compare  # noqa: E402
import sprite_tools as tools  # noqa: E402
import video_to_sheet as sheets  # noqa: E402

META_KEY = "ai-draw"
COMMON_FPS = (6, 8, 10, 12, 15, 24, 25, 30)


def probe(video: str) -> dict:
    """Frame size and rate of a clip (ffprobe)."""
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                             "stream=width,height,r_frame_rate", "-of", "json", video], capture_output=True, text=True, check=True)
    stream = json.loads(result.stdout)["streams"][0]
    numerator, _, denominator = stream["r_frame_rate"].partition("/")
    return {"width": stream["width"], "height": stream["height"], "fps": float(numerator) / float(denominator or 1)}


def occupied(alpha: Image.Image, axis: int) -> list:
    """Per column (axis 0) or row (axis 1): does any pixel there have visible alpha?"""
    mask = alpha.point(lambda value: 255 if value > 8 else 0)
    size = (alpha.width, 1) if axis == 0 else (1, alpha.height)
    return [value > 0 for value in mask.resize(size, Image.Resampling.BOX).tobytes()]


def grid_count(used: list, cell_hint=None):
    """How many cells fit along one axis: every boundary between cells must be empty."""
    length = len(used)

    def fits(count):
        cell = length // count
        return length % count == 0 and all(not used[k * cell - 1] and not used[k * cell] for k in range(1, count))

    if cell_hint and length % cell_hint == 0 and fits(length // cell_hint):
        return length // cell_hint
    runs = sum(1 for index, value in enumerate(used) if value and (index == 0 or not used[index - 1]))
    return runs if runs and fits(runs) else None


def find_grid(sheet: Image.Image, hint=None) -> tuple[int, int]:
    alpha = sheet.getchannel("A")
    if alpha.getextrema()[0] == 255:
        raise ValueError("导出的图没有透明部分，找不出网格：用 --grid 列x行 指定（或者在「编辑帧」里重新导出，新导出自带元数据）")
    columns = grid_count(occupied(alpha, 0), hint and hint[0])
    rows = grid_count(occupied(alpha, 1), hint and hint[1])
    if not (columns and rows):
        raise ValueError("推算不出网格（人物跨过了格子边界？）：用 --grid 列x行 指定")
    return columns, rows


def read_export(path: Path, grid=None, hint=None):
    """(raw frames, metadata or None, grid). Cells are read row by row and blank cells are dropped."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = sorted(name for name in archive.namelist() if name.lower().endswith(".png"))
            meta = json.loads(archive.read("meta.json")) if "meta.json" in archive.namelist() else None
            frames = []
            for name in names:
                with archive.open(name) as file:
                    frames.append(Image.open(file).convert("RGBA"))
        return frames, meta, None
    with Image.open(path) as source:
        meta = json.loads(source.text[META_KEY]) if META_KEY in getattr(source, "text", {}) else None
        sheet = source.convert("RGBA")
    if meta and not grid:
        grid = (meta["cols"], meta["rows"])
    grid = grid or find_grid(sheet, hint)
    width, height = sheet.width // grid[0], sheet.height // grid[1]
    if (width * grid[0], height * grid[1]) != sheet.size:
        raise ValueError(f"{sheet.width}×{sheet.height} 不能均分成 {grid[0]}×{grid[1]} 格")
    cells = [sheet.crop((column * width, row * height, (column + 1) * width, (row + 1) * height))
             for row in range(grid[1]) for column in range(grid[0])]
    if meta and meta.get("frames"):
        cells = cells[: meta["frames"]]
    return [cell for cell in cells if cell.getchannel("A").getbbox()], meta, grid


def match_source(frames: list, video: str) -> list:
    """Index of the closest clip frame for every frame (compared on white, as the clip was rendered)."""
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", video, "-fps_mode", "passthrough", "-start_number", "0",
                        str(Path(directory) / "f_%04d.png")], check=True)
        clip = [Image.open(path).convert("RGBA") for path in sorted(Path(directory).glob("f_*.png"))]
    source, edited = sheets.thumbnails(clip), sheets.thumbnails(frames)
    return [min(range(len(source)), key=lambda index: tools.frame_difference(thumb, source[index])) for thumb in edited]


def snap_fps(estimate: float, source_fps: float) -> float:
    """The extraction rate the user most likely chose: the clip's own rate, else a common one, within 10%."""
    for candidate in (source_fps, *COMMON_FPS):
        if abs(estimate - candidate) <= 0.1 * candidate:
            return float(candidate)
    return round(estimate, 1)


def framing_from(previous: dict, frames: list, headroom: int, margin: int):
    """Reuse the delivered crop (same coordinate space as the clip): same scale, feet row and centre line."""
    left, top, right, bottom = previous["crop_box"]
    unit = (bottom - top) / previous["frameHeight"]
    union = tools.union_bbox(frames)
    centre = (left + right) / 2
    half = max((right - left) / 2, max(centre - union[0], union[2] - centre) + margin * unit)
    extra = math.ceil((top - union[1]) / unit) + headroom if union[1] < top else 0
    height = previous["frameHeight"] + extra
    box = (round(centre - half), round(bottom - height * unit), round(centre + half), bottom)
    return box, (round((box[2] - box[0]) / unit), height), 1 / unit


def uncropped(meta, size: tuple) -> bool:
    """The export's own record says every frame keeps the clip's full frame (no crop, no resize)."""
    items = (meta or {}).get("items") or []
    return bool(items) and all((item.get("width"), item.get("height")) == (item.get("source_width"), item.get("source_height"))
                               == size for item in items)


def run(args) -> dict:
    export, work = Path(args.export), Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    warnings = []
    clip = probe(args.video) if args.video else None
    grid = tuple(int(value) for value in args.grid.lower().split("x")) if args.grid else None
    raw, meta, grid = read_export(export, grid, clip and (clip["width"], clip["height"]))
    if not raw:
        return {"ok": False, "error": "导出里没有帧"}
    duplicates = [index for index in range(1, len(raw)) if ImageChops.difference(raw[index], raw[index - 1]).getbbox() is None]
    if args.drop_duplicates:
        raw = [frame for index, frame in enumerate(raw) if index not in duplicates]

    # Frames still on their backdrop get the project's cutout; the user's own cutouts only get the lossless clean-up.
    if any(frame.getchannel("A").getextrema()[0] == 255 for frame in raw):
        if not args.cutout:
            return {"ok": False, "error": "导出的帧还带着背景：加 --cutout <算法>（项目选定的那种，见 art/style.md）"}
        cells = work / "cells"
        cells.mkdir(exist_ok=True)
        for old in cells.glob("frame_*.png"):
            old.unlink()
        paths = []
        for index, frame in enumerate(raw):
            frame.save(cells / f"frame_{index:03d}.png")
            paths.append(cells / f"frame_{index:03d}.png")
        try:
            frames, _ = sheets.cut_frames(paths, args.cutout, work)
        except RuntimeError as error:
            return {"ok": False, "error": str(error)}
        cutout = args.cutout
    else:
        frames, cutout = [cutout_compare.clean(frame) for frame in raw], "用户在编辑帧里抠图"

    # Frame rate (real-time speed): --fps, else the export's record (the spacing of the frames' source times, else its
    # extraction fps), else matched against the clip, else 8.
    source_frames = None
    times = sorted(item["time"] for item in (meta or {}).get("items") or [] if isinstance(item.get("time"), (int, float)))
    gaps = [later - earlier for earlier, later in zip(times, times[1:]) if later > earlier]
    if args.fps:
        fps, fps_from = args.fps, "--fps"
    elif gaps:
        fps, fps_from = snap_fps(1 / statistics.median(gaps), (meta or {}).get("source_fps") or 24), "metadata"
    elif meta and meta.get("fps"):
        fps, fps_from = float(meta["fps"]), "metadata"
    elif clip and frames[0].size == (clip["width"], clip["height"]) and len(frames) > 1:
        indices = match_source(raw, args.video)
        source_frames = [indices[0], indices[-1]]
        span = indices[-1] - indices[0]
        fps = snap_fps(clip["fps"] * (len(indices) - 1) / span, clip["fps"]) if span > 0 else 8.0
        fps_from = "video"
    else:
        fps, fps_from = 8.0, "default"
        warnings.append("导出没有元数据，也没给 --fps 或 --video，帧率先按 8")
    if times and (meta or {}).get("source_fps"):
        source_frames = [round(times[0] * meta["source_fps"]), round(times[-1] * meta["source_fps"])]
    preview = (meta or {}).get("playback_fps")
    if isinstance(preview, (int, float)) and abs(preview - fps) > 0.5:
        warnings.append(f"编辑器里的预览速度是每秒 {preview:g} 帧，按抽帧的每秒 {fps:g} 帧交付（真实速度）；想按预览速度播放就改帧率")

    # Framing: the delivered crop when the frames are still in the clip's coordinates, else the static sprite.
    same_space = (clip is not None and frames[0].size == (clip["width"], clip["height"])) or uncropped(meta, frames[0].size)
    previous = json.loads(Path(args.framing_from).read_text()) if args.framing_from else None
    reference = tools.load(args.match) if args.match else None
    if previous and same_space:
        box, size, scale = framing_from(previous, frames, args.headroom, args.margin)
        extra = size[1] - (reference.height if reference is not None else previous["frameHeight"])
        framing = "framing-from"
    else:
        if previous:
            warnings.append("帧尺寸和原视频不同（裁切或缩放过），改按立绘对齐")
        box, size, scale = sheets.framing(frames[0], frames, reference, args.height, args.pad, args.margin, args.headroom)
        extra = size[1] - (reference.height if reference is not None else args.height)
        framing = "match"
    cropped = [sheets.crop(frame, box, size) for frame in frames]
    play_fps = args.play_fps or [fps]
    result = sheets.write_sheet(cropped, size, args.out, work, args.columns, play_fps)
    jump = sheets.loop_jump(cropped) if len(cropped) > 2 else None
    if duplicates and not args.drop_duplicates:
        warnings.append(f"有 {len(duplicates)} 处相邻两帧完全一样（第 {', '.join(map(str, duplicates))} 帧），播放时会轻微顿一下")
    if jump is not None and jump > 2:
        warnings.append(f"循环接缝的跳变是普通相邻帧的 {jump:.1f} 倍：结尾没回到开头的姿势，每轮回到开头会跳一下")
    result.update({"crop_box": list(box), "scale": round(scale, 5), "extra_height": extra, "framing": framing,
                   "grid": list(grid) if grid else None, "metadata": meta is not None, "fps": fps, "fps_from": fps_from,
                   "source_frames": source_frames, "duplicates": duplicates, "dropped_duplicates": args.drop_duplicates,
                   "loop_jump": round(jump, 2) if jump is not None else None, "cutout": cutout, "warnings": warnings})
    (work / "sheet.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    registered = {}
    if args.pack or args.spec or args.job:
        source = {"edited_by_user": args.source_url or str(export), "video": args.video or (meta or {}).get("source_video_url"),
                  "cutout": cutout, "export": {"metadata": meta is not None, "grid": result["grid"], "frames": len(cropped),
                                               "fps": fps, "fps_from": fps_from, "source_frames": source_frames,
                                               "duplicates": len(duplicates), "dropped_duplicates": args.drop_duplicates}}
        registered = sheets.register(Path(result["out"]), result, key=args.key, pack=args.pack, url=args.url,
                                     section=args.section, spec=args.spec, job=args.job, fps=fps, source=source,
                                     notes=sheets.framing_note(args.match, extra), step="user-edit",
                                     record={"source": args.source_url or str(export), "warnings": warnings})
    return {"ok": True, **result, "registered": registered}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="用户在「编辑帧」里导出的精灵图或帧 ZIP → 对齐立绘的精灵图，并登记进项目")
    parser.add_argument("export", help="导出的精灵图 PNG 或帧 ZIP（本地文件；gate wait --download 或 round get --out 下载的）")
    parser.add_argument("-o", "--out", required=True, help="精灵图输出路径，例如 public/assets/characters/heroine_idle.png")
    parser.add_argument("--work", required=True, help="中间文件目录")
    parser.add_argument("--match", help="静态立绘：比例、脚底行和中线与它一致")
    parser.add_argument("--framing-from", help="自动交付时的 sheet.json：帧还在原视频坐标里时，沿用它的裁切框和比例")
    parser.add_argument("--video", help="原视频：提供帧尺寸，旧导出靠它推算网格和帧率")
    parser.add_argument("--grid", help="列x行，例如 11x6；旧导出推算不出时指定")
    parser.add_argument("--fps", type=float, help="播放帧率；默认取导出的元数据，没有时按原视频推算")
    parser.add_argument("--play-fps", type=lambda text: [float(value) for value in text.split(",")],
                        help="预览的播放帧率，逗号分隔；默认就是 --fps 的值")
    parser.add_argument("--drop-duplicates", action="store_true", help="去掉和前一帧完全一样的帧（默认保留用户导出的原样）")
    parser.add_argument("--cutout", help="帧还带背景时用的抠图算法（项目选定的那种）")
    parser.add_argument("--headroom", type=int, default=4)
    parser.add_argument("--margin", type=int, default=4)
    parser.add_argument("--height", type=int, default=340, help="没有 --match 时的帧高")
    parser.add_argument("--pad", type=int, default=4, help="没有 --match 时人物上下留白")
    parser.add_argument("--columns", type=int)
    parser.add_argument("--source-url", help="编辑结果在 ai-draw 里的地址，记进规格和任务日志")
    parser.add_argument("--pack")
    parser.add_argument("--key")
    parser.add_argument("--url")
    parser.add_argument("--section", default="characters")
    parser.add_argument("--spec")
    parser.add_argument("--job")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if (args.pack or args.spec) and not args.key:
        print(json.dumps({"ok": False, "error": "登记时需要 --key"}, ensure_ascii=False))
        return 1
    try:
        result = run(args)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
