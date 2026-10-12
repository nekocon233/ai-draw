#!/usr/bin/env python3
"""One command from a picked video to a sprite sheet that is already wired into the project.

    video → frames (ffmpeg) → background removal by ai-draw (`aidraw rmbg --variant`, the algorithm picked with
    cutout_compare.py) → one shared crop box matched to the static sprite (same frame height, feet row and centre line)
    → optional loop trim → sprite sheet + speed previews → (optional) asset pack registration, art/spec.json entry
    and a job-log record.

Prints one JSON object. Pillow + ffmpeg, and the aidraw CLI for the cutout.
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_pack  # noqa: E402
import cutout_compare  # noqa: E402
import sprite_tools as tools  # noqa: E402


def framing(first: Image.Image, frames: list, reference, height: int, pad: int, margin: int):
    """Crop box (source pixels) and output size so frame 0's figure lands exactly where the static sprite's does."""
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
    box = (round(centre - half), round(y0), round(centre + half), round(y1))
    size = (max(1, round((box[2] - box[0]) * target_height / (box[3] - box[1]))), target_height)
    return box, size, scale


def crop(image: Image.Image, box: tuple, size: tuple) -> Image.Image:
    canvas = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    tools.composite_at(canvas, image, -box[0], -box[1])
    return tools.premultiplied_resize(canvas, size)


def loop_jump(frames: list) -> float:
    """Wrap-around difference relative to an ordinary step (≈0: last repeats first, ≈1: seamless)."""
    thumbs = []
    for frame in frames:
        board = Image.new("RGBA", frame.size, (255, 255, 255, 255))
        board.alpha_composite(frame)
        thumbs.append(board.convert("L").resize((48, max(1, round(48 * frame.height / frame.width)))))
    steps = [tools.frame_difference(thumbs[i], thumbs[i + 1]) for i in range(len(thumbs) - 1)]
    typical = max(sum(steps) / max(1, len(steps)), 0.01)
    return tools.frame_difference(thumbs[-1], thumbs[0]) / typical


def project_url(sheet: Path) -> str:
    parts = sheet.resolve().parts
    return "/".join(parts[parts.index("public") + 1:]) if "public" in parts else sheet.name


def register(args, meta: dict, sheet: Path) -> dict:
    done = {}
    if args.pack:
        pack_args = SimpleNamespace(pack=args.pack, key=args.key, url=args.url or project_url(sheet), type="spritesheet",
                                    section=args.section, frame_width=meta["frameWidth"], frame_height=meta["frameHeight"],
                                    end_frame=None, atlas_url=None)
        done["pack"] = asset_pack.cmd_register(pack_args)
    if args.spec:
        spec = asset_pack.read_json(args.spec) if Path(args.spec).exists() else {"version": 1, "assets": {}}
        entry = spec.setdefault("assets", {}).get(args.key, {})
        entry.update({
            "path": str(sheet), "kind": "animation", "size": {"w": meta["frameWidth"], "h": meta["frameHeight"]},
            "frames": meta["frames"], "fps": args.play_fps[0] if args.play_fps else None, "alpha": True,
            "ai": True, "status": "generated",
            "source": {"video": args.video, "sample_fps": args.sample_fps, "match": args.match, "cutout": args.cutout,
                       "loop_trimmed": meta["loop_trimmed"]},
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        })
        if args.match:
            entry.setdefault("notes", f"帧高、脚底和中线与 {Path(args.match).name} 一致")
        spec["assets"][args.key] = entry
        asset_pack.write_json(args.spec, spec, 2)
        done["spec"] = args.key
    if args.job:
        record = {"ts": datetime.now().astimezone().isoformat(timespec="seconds"), "event": "deliver", "step": "video-to-sheet",
                  "key": args.key, "file": str(sheet), "video": args.video, "cutout": args.cutout, "frames": meta["frames"],
                  "frame_size": [meta["frameWidth"], meta["frameHeight"]], "previews": meta["previews"]}
        Path(args.job).parent.mkdir(parents=True, exist_ok=True)
        with open(args.job, "a", encoding="utf-8") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
        done["job"] = args.job
    return done


def run(args) -> dict:
    work = Path(args.work)
    extracted = tools.cmd_extract(SimpleNamespace(video=args.video, out=str(work / "frames"), fps=args.sample_fps,
                                                  start=args.start, end=args.end))
    if not extracted["ok"]:
        return extracted
    paths = tools.frame_paths(work / "frames")[: args.max_frames or None]
    raw_dir = work / "cut-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for old in raw_dir.glob("*.png"):
        old.unlink()
    removed = cutout_compare.run_aidraw("rmbg", *map(str, paths), "--variant", args.cutout, "--out", str(raw_dir))
    if not removed.get("ok"):
        return {"ok": False, "error": f"抠图失败：{removed.get('error')}"}
    cut = [cutout_compare.clean(tools.load(raw_dir / path.name)) for path in paths]
    reference = tools.load(args.match) if args.match else None
    box, size, scale = framing(cut[0], cut, reference, args.height, args.pad, args.margin)
    frames = [crop(image, box, size) for image in cut]
    jump = loop_jump(frames) if len(frames) > 2 else None
    trimmed = bool(args.loop == "auto" and jump is not None and jump < 0.5)
    if trimmed:
        frames = frames[:-1]  # the clip ends on its first frame; keeping both would hold that pose twice
    crop_dir = work / "crop"
    crop_dir.mkdir(parents=True, exist_ok=True)
    for old in crop_dir.glob("frame_*.png"):
        old.unlink()
    for index, frame in enumerate(frames):
        frame.save(crop_dir / f"frame_{index:03d}.png")
    columns = args.columns or max(1, min(len(frames), 4096 // size[0]))
    sheet_image = Image.new("RGBA", (columns * size[0], -(-len(frames) // columns) * size[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet_image.paste(frame, ((index % columns) * size[0], (index // columns) * size[1]))
    sheet = Path(tools.save(sheet_image, args.out))
    previews = []
    for fps in args.play_fps or []:
        target = work / f"preview_{fps:g}fps.webp"
        tools.cmd_anim_preview(SimpleNamespace(files=[str(path) for path in sorted(crop_dir.glob("frame_*.png"))],
                                               out=str(target), fps=fps, checker=True))
        previews.append(str(target))
    feet = [tools.alpha_bbox(frame, 8) for frame in frames]
    feet = [item[3] for item in feet if item]
    meta = {"frameWidth": size[0], "frameHeight": size[1], "frames": len(frames), "columns": columns,
            "sheet": list(sheet_image.size), "crop_box": list(box), "scale": round(scale, 5),
            "loop_jump": round(jump, 2) if jump is not None else None, "loop_trimmed": trimmed,
            "feet_bottom": [min(feet), max(feet)] if feet else None, "previews": previews}
    (work / "sheet.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "out": str(sheet), **meta, "registered": register(args, meta, sheet)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="视频 → 精灵图，一条命令完成抽帧、抠图、对齐、打包和登记")
    parser.add_argument("video")
    parser.add_argument("-o", "--out", required=True, help="精灵图输出路径，例如 public/assets/characters/heroine_idle.png")
    parser.add_argument("--work", required=True, help="中间文件目录（frames/、crop/、预览、sheet.json）")
    parser.add_argument("--match", help="静态立绘：帧高、脚底行和中线与它一致（推荐）")
    parser.add_argument("--height", type=int, default=340, help="没有 --match 时的帧高")
    parser.add_argument("--pad", type=int, default=4, help="没有 --match 时人物上下留白")
    parser.add_argument("--margin", type=int, default=4, help="左右在所有帧外框之外再留的像素（输出尺寸）")
    parser.add_argument("--sample-fps", type=float, default=8, help="抽帧帧率：决定帧数")
    parser.add_argument("--play-fps", type=lambda text: [float(value) for value in text.split(",")], default=[8.0],
                        help="预览的播放帧率，逗号分隔，例如 6,8,10；第一个写进规格")
    parser.add_argument("--start", type=float)
    parser.add_argument("--end", type=float)
    parser.add_argument("--max-frames", type=int)
    parser.add_argument("--loop", choices=("auto", "none"), default="auto", help="auto：尾帧和首帧几乎一样时去掉尾帧")
    parser.add_argument("--cutout", required=True, help="抠图算法（aidraw rmbg --list），先用 cutout_compare.py 在第一帧上对比选定")
    parser.add_argument("--columns", type=int)
    parser.add_argument("--pack", help="asset pack 路径：登记为 spritesheet")
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
