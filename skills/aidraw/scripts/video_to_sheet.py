#!/usr/bin/env python3
"""One command from a picked video to a sprite sheet that is already wired into the project.

    video → frames (ffmpeg) → background removal by ai-draw (`aidraw rmbg --variant`, the algorithm picked with
    cutout_compare.py; cached by frame content, so a re-run only cuts frames it has not seen) → still holds at the
    start and end trimmed → one shared crop box matched to the static sprite (same scale, feet row and centre line;
    taller when a frame rises above it, with headroom) → loop trim → sprite sheet without blank cells when the count
    allows + speed previews → (optional) asset pack registration with endFrame, art/spec.json entry and a job-log record.

The framing, packing and registration are shared with edit_to_sheet.py (the user's own 编辑帧 export).
Prints one JSON object. Pillow + ffmpeg, and the aidraw CLI for the cutout.
"""
import argparse
import hashlib
import json
import math
import shutil
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_pack  # noqa: E402
import cutout_compare  # noqa: E402
import sprite_tools as tools  # noqa: E402

MAX_SIDE = 4096     # texture limit every WebGL device takes
STILL_RATIO = 0.15  # a step below this share of a typical moving step is standing still


def framing(first: Image.Image, frames: list, reference, height: int, pad: int, margin: int, headroom: int = 0):
    """Crop box (source pixels) and output size so frame 0's figure lands exactly where the static sprite's does.

    When another frame rises above the sprite's top (a deep breath lifting the hair), the box grows upwards by that
    much plus `headroom` output pixels instead of cutting it off; scale, feet row and centre line stay the same.
    """
    box0 = tools.alpha_bbox(first, 8)
    if box0 is None:
        raise ValueError("第一帧抠图后是空的，换一种抠图算法（先用 cutout_compare.py 对比）")
    if reference is not None:
        ref_box = tools.alpha_bbox(reference, 8)
        target_height = reference.height
        figure = ref_box[3] - ref_box[1]
        top, bottom = ref_box[1], reference.height - ref_box[3]
        offset = (ref_box[0] + ref_box[2]) / 2 - reference.width / 2
    else:
        target_height = height
        figure = height - 2 * pad
        top = bottom = pad
        offset = 0
    scale = figure / (box0[3] - box0[1])
    y0, y1 = box0[1] - top / scale, box0[3] + bottom / scale
    centre = (box0[0] + box0[2]) / 2 - offset / scale
    union = tools.union_bbox(frames)
    half = max(centre - union[0], union[2] - centre) + margin / scale
    unit = (y1 - y0) / target_height  # source pixels per output pixel
    extra = math.ceil((y0 - union[1]) / unit) + headroom if union[1] < y0 else 0
    out_height = target_height + extra
    box = (round(centre - half), round(y1 - out_height * unit), round(centre + half), round(y1))
    size = (max(1, round((box[2] - box[0]) * out_height / (box[3] - box[1]))), out_height)
    return box, size, scale


def crop(image: Image.Image, box: tuple, size: tuple) -> Image.Image:
    canvas = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    tools.composite_at(canvas, image, -box[0], -box[1])
    return tools.premultiplied_resize(canvas, size)


def thumbnails(frames: list) -> list:
    thumbs = []
    for frame in frames:
        board = Image.new("RGBA", frame.size, (255, 255, 255, 255))
        board.alpha_composite(frame)
        thumbs.append(board.convert("L").resize((48, max(1, round(48 * frame.height / frame.width)))))
    return thumbs


def loop_jump(frames: list) -> float:
    """Wrap-around difference relative to an ordinary step (≈0: last repeats first, ≈1: seamless)."""
    thumbs = thumbnails(frames)
    steps = [tools.frame_difference(thumbs[i], thumbs[i + 1]) for i in range(len(thumbs) - 1)]
    typical = max(sum(steps) / max(1, len(steps)), 0.01)
    return tools.frame_difference(thumbs[-1], thumbs[0]) / typical


def still_ends(frames: list, ratio: float = STILL_RATIO, minimum: int = 2) -> tuple[int, int]:
    """Frames to drop at the start and the end where the clip only holds a pose (H3 often arrives early and waits).

    A step is still when it is below `ratio` of the typical moving step (the mean of the larger half); runs shorter
    than `minimum` steps are kept. The last frame of a trailing hold stays, so the motion still comes to rest.
    """
    if len(frames) < 4:
        return 0, 0
    thumbs = thumbnails(frames)
    steps = [tools.frame_difference(thumbs[i], thumbs[i + 1]) for i in range(len(thumbs) - 1)]
    moving = sorted(steps, reverse=True)[: max(1, len(steps) // 2)]
    threshold = ratio * sum(moving) / len(moving)
    head = 0
    while head < len(steps) and steps[head] < threshold:
        head += 1
    tail = 0
    while tail < len(steps) - head and steps[-1 - tail] < threshold:
        tail += 1
    return (head if head >= minimum else 0), (tail if tail >= minimum else 0)


def cut_frames(paths: list, variant: str, work: Path) -> tuple[list, int]:
    """Cutouts by ai-draw, cached in work/cut-cache/<variant>/<sha1 of the frame>.png; returns (cut, reused)."""
    cache = work / "cut-cache" / variant
    cache.mkdir(parents=True, exist_ok=True)
    raw_dir = work / "cut-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for old in raw_dir.glob("*.png"):
        old.unlink()
    keys = {path: hashlib.sha1(path.read_bytes()).hexdigest() for path in paths}
    missing = [path for path in paths if not (cache / f"{keys[path]}.png").exists()]
    if missing:
        removed = cutout_compare.run_aidraw("rmbg", *map(str, missing), "--variant", variant, "--out", str(raw_dir))
        if not removed.get("ok"):
            raise RuntimeError(f"抠图失败：{removed.get('error')}")
        for path in missing:
            shutil.copyfile(raw_dir / path.name, cache / f"{keys[path]}.png")
    for path in paths:
        if path not in missing:
            shutil.copyfile(cache / f"{keys[path]}.png", raw_dir / path.name)
    return [cutout_compare.clean(tools.load(raw_dir / path.name)) for path in paths], len(paths) - len(missing)


def layout(count: int, size: tuple, limit: int = MAX_SIDE) -> int:
    """Columns that fill every cell when the count allows (the squarest such sheet), else the widest row."""
    exact = [columns for columns in range(1, count + 1)
             if count % columns == 0 and columns * size[0] <= limit and count // columns * size[1] <= limit]
    if exact:
        return min(exact, key=lambda columns: abs(columns * size[0] - count // columns * size[1]))
    return max(1, min(count, limit // size[0]))


def write_sheet(frames: list, size: tuple, out, work: Path, columns=None, play_fps=None) -> dict:
    """Crop frames, the sheet and checkerboard previews (one per playback speed)."""
    crop_dir = work / "crop"
    crop_dir.mkdir(parents=True, exist_ok=True)
    for old in crop_dir.glob("frame_*.png"):
        old.unlink()
    for index, frame in enumerate(frames):
        frame.save(crop_dir / f"frame_{index:03d}.png")
    columns = columns or layout(len(frames), size)
    sheet_image = Image.new("RGBA", (columns * size[0], -(-len(frames) // columns) * size[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet_image.paste(frame, ((index % columns) * size[0], (index // columns) * size[1]))
    sheet = Path(tools.save(sheet_image, out))
    previews = []
    for fps in play_fps or []:
        target = work / f"preview_{fps:g}fps.webp"
        tools.cmd_anim_preview(SimpleNamespace(files=[str(path) for path in sorted(crop_dir.glob("frame_*.png"))],
                                               out=str(target), fps=fps, checker=True))
        previews.append(str(target))
    feet = [box[3] for box in (tools.alpha_bbox(frame, 8) for frame in frames) if box]
    tops = [box[1] for box in (tools.alpha_bbox(frame, 8) for frame in frames) if box]
    return {"out": str(sheet), "frameWidth": size[0], "frameHeight": size[1], "frames": len(frames), "columns": columns,
            "sheet": list(sheet_image.size), "blank_cells": columns * -(-len(frames) // columns) - len(frames),
            "top_margin": min(tops) if tops else None, "feet_bottom": [min(feet), max(feet)] if feet else None,
            "previews": previews}


def project_url(sheet: Path) -> str:
    parts = sheet.resolve().parts
    return "/".join(parts[parts.index("public") + 1:]) if "public" in parts else sheet.name


def framing_note(match, extra: int) -> str:
    note = f"比例、脚底行和中线与 {Path(match).name} 一致" if match else ""
    if extra > 0:
        note += f"{'；' if note else ''}帧顶比它高 {extra} px，给动作留的头顶空间"
    return note


def register(sheet: Path, meta: dict, *, key, pack=None, url=None, section="characters", spec=None, job=None,
             fps=None, source=None, notes="", step="video-to-sheet", record=None) -> dict:
    """Asset pack entry (always with endFrame, so blank cells never play), the spec entry and a job-log record."""
    done = {}
    if pack:
        pack_args = SimpleNamespace(pack=pack, key=key, url=url or project_url(sheet), type="spritesheet", section=section,
                                    frame_width=meta["frameWidth"], frame_height=meta["frameHeight"],
                                    end_frame=meta["frames"] - 1, atlas_url=None)
        done["pack"] = asset_pack.cmd_register(pack_args)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    if spec:
        data = asset_pack.read_json(spec) if Path(spec).exists() else {"version": 1, "assets": {}}
        entry = data.setdefault("assets", {}).get(key, {})
        entry.update({"path": str(sheet), "kind": "animation", "size": {"w": meta["frameWidth"], "h": meta["frameHeight"]},
                      "frames": meta["frames"], "fps": fps, "alpha": True, "ai": True, "status": "generated",
                      "source": source or {}, "updated_at": now})
        if notes:
            entry["notes"] = notes
        data["assets"][key] = entry
        asset_pack.write_json(spec, data, 2)
        done["spec"] = key
    if job:
        entry = {"ts": now, "event": "deliver", "step": step, "key": key, "file": str(sheet), "frames": meta["frames"],
                 "frame_size": [meta["frameWidth"], meta["frameHeight"]], "fps": fps, "previews": meta.get("previews"),
                 **(record or {})}
        Path(job).parent.mkdir(parents=True, exist_ok=True)
        with open(job, "a", encoding="utf-8") as log:
            log.write(json.dumps(entry, ensure_ascii=False) + "\n")
        done["job"] = job
    return done


def run(args) -> dict:
    work = Path(args.work)
    extracted = tools.cmd_extract(SimpleNamespace(video=args.video, out=str(work / "frames"), fps=args.sample_fps,
                                                  start=args.start, end=args.end))
    if not extracted["ok"]:
        return extracted
    paths = tools.frame_paths(work / "frames")[: args.max_frames or None]
    try:
        cut, reused = cut_frames(paths, args.cutout, work)
    except RuntimeError as error:
        return {"ok": False, "error": str(error)}
    head, tail = still_ends(cut) if args.trim_still == "auto" else (0, 0)
    kept = cut[head:len(cut) - tail]
    reference = tools.load(args.match) if args.match else None
    box, size, scale = framing(cut[0], kept, reference, args.height, args.pad, args.margin, args.headroom)
    frames = [crop(image, box, size) for image in kept]
    jump = loop_jump(frames) if len(frames) > 2 else None
    trimmed = bool(args.loop == "auto" and jump is not None and jump < 0.5)
    if trimmed:
        frames = frames[:-1]  # the clip ends on its first frame; keeping both would hold that pose twice
    meta = write_sheet(frames, size, args.out, work, args.columns, args.play_fps)
    extra = size[1] - (reference.height if reference is not None else args.height)
    meta.update({"crop_box": list(box), "scale": round(scale, 5), "extra_height": extra,
                 "kept": [head, head + len(frames) - 1], "sampled": len(cut), "trimmed_still": {"head": head, "tail": tail},
                 "loop_jump": round(jump, 2) if jump is not None else None, "loop_trimmed": trimmed, "cutout_reused": reused})
    (work / "sheet.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    registered = {}
    if args.pack or args.spec or args.job:
        fps = args.play_fps[0] if args.play_fps else None
        source = {"video": args.video, "sample_fps": args.sample_fps, "match": args.match, "cutout": args.cutout,
                  "frames_kept": meta["kept"], "trimmed_still": meta["trimmed_still"], "loop_trimmed": trimmed}
        registered = register(Path(meta["out"]), meta, key=args.key, pack=args.pack, url=args.url, section=args.section,
                              spec=args.spec, job=args.job, fps=fps, source=source, notes=framing_note(args.match, extra),
                              record={"video": args.video, "cutout": args.cutout, "kept": meta["kept"]})
    return {"ok": True, **meta, "registered": registered}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="视频 → 精灵图，一条命令完成抽帧、抠图、对齐、打包和登记")
    parser.add_argument("video")
    parser.add_argument("-o", "--out", required=True, help="精灵图输出路径，例如 public/assets/characters/heroine_idle.png")
    parser.add_argument("--work", required=True, help="中间文件目录（frames/、cut-cache/、crop/、预览、sheet.json）")
    parser.add_argument("--match", help="静态立绘：比例、脚底行和中线与它一致（推荐）")
    parser.add_argument("--height", type=int, default=340, help="没有 --match 时的帧高")
    parser.add_argument("--pad", type=int, default=4, help="没有 --match 时人物上下留白")
    parser.add_argument("--margin", type=int, default=4, help="左右在所有帧外框之外再留的像素（输出尺寸）")
    parser.add_argument("--headroom", type=int, default=4, help="有帧高过立绘顶部时，最高处上方再留的像素（输出尺寸）")
    parser.add_argument("--sample-fps", type=float, default=8, help="抽帧帧率：决定帧数")
    parser.add_argument("--play-fps", type=lambda text: [float(value) for value in text.split(",")], default=[8.0],
                        help="预览的播放帧率，逗号分隔，例如 6,8,10；第一个写进规格")
    parser.add_argument("--start", type=float)
    parser.add_argument("--end", type=float)
    parser.add_argument("--max-frames", type=int)
    parser.add_argument("--trim-still", choices=("auto", "none"), default="auto",
                        help="auto：去掉开头和结尾只是停住不动的帧（H3 常常提前做完动作，然后停着等结尾）")
    parser.add_argument("--loop", choices=("auto", "none"), default="auto", help="auto：尾帧和首帧几乎一样时去掉尾帧")
    parser.add_argument("--cutout", required=True, help="抠图算法（aidraw rmbg --list），先用 cutout_compare.py 在第一帧上对比选定")
    parser.add_argument("--columns", type=int, help="默认自动：能排满就不留空格子")
    parser.add_argument("--pack", help="asset pack 路径：登记为 spritesheet（带 endFrame）")
    parser.add_argument("--key", help="贴图 key（登记 asset pack / 规格时必填）")
    parser.add_argument("--url", help="asset pack 里的地址；默认取 public/ 之后的路径")
    parser.add_argument("--section", default="characters")
    parser.add_argument("--spec", help="art/spec.json：写入或更新这个 key")
    parser.add_argument("--job", help="任务日志：追加一条 deliver 记录")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if (args.pack or args.spec) and not args.key:
        print(json.dumps({"ok": False, "error": "登记时需要 --key"}, ensure_ascii=False))
        return 1
    try:
        result = run(args)
    except (OSError, ValueError) as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
