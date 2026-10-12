#!/usr/bin/env python3
"""Every background-removal algorithm of ai-draw on one image, cleaned the same way and laid out side by side.

    aidraw rmbg --all → clean (clean-alpha, defringe) → clean/<variant>.png
                      → compare.png (loud magenta backdrop) and compare_dark.png, numbered with the web UI's names

The agent looks at the sheets and picks; video_to_sheet.py --cutout then runs that algorithm on every frame.
`bg_like` is the share of opaque pixels that still have the source's backdrop colour: the subject's own white parts
count the same for every algorithm, so a variant clearly above the others has kept background in enclosed gaps.
Prints one JSON object. Pillow only.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprite_tools as tools  # noqa: E402

COLUMNS = 7          # 13 algorithms → 7 + 6, small enough to read in one look
CELL = (210, 420)    # tile size; tall because characters are
LABEL = 44


def run_aidraw(*args: str) -> dict:
    """Run the aidraw CLI and return its JSON (tests replace this)."""
    result = subprocess.run(["aidraw", "--quiet", *args], capture_output=True, text=True)
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        payload = {"ok": False, "error": (result.stderr or result.stdout).strip()[-400:]}
    if result.returncode != 0:
        payload["ok"] = False
        payload.setdefault("error", f"aidraw 退出码 {result.returncode}")
    return payload


def clean(image: Image.Image) -> Image.Image:
    """The clean-up every algorithmic cutout gets: drop faint specks, then replace the backdrop colour in soft edges."""
    return tools.defringe_image(tools.clean_alpha_image(image, 12, 3), 2, 4)


def bg_like(image: Image.Image, backdrop: tuple) -> float:
    solid = image.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    near = tools.max_channel_difference(image, backdrop).point(lambda value: 255 if value <= 24 else 0)
    both = Image.composite(near, Image.new("L", image.size, 0), solid)
    total = solid.histogram()[255]
    return round(both.histogram()[255] / total, 4) if total else 0.0


def view_box(images: list) -> tuple:
    """One crop for every tile so they compare like for like; boxes far larger than the median (a variant that kept
    the whole backdrop) are left out so they do not shrink everybody else."""
    boxes = [tools.alpha_bbox(image, 8) for image in images]
    boxes = [box for box in boxes if box]
    areas = sorted((box[2] - box[0]) * (box[3] - box[1]) for box in boxes)
    median = areas[len(areas) // 2]
    usual = [box for box in boxes if (box[2] - box[0]) * (box[3] - box[1]) <= 1.5 * median] or boxes
    left, top = min(box[0] for box in usual), min(box[1] for box in usual)
    right, bottom = max(box[2] for box in usual), max(box[3] for box in usual)
    pad = max(4, round(0.03 * max(right - left, bottom - top)))
    width, height = images[0].size
    return max(0, left - pad), max(0, top - pad), min(width, right + pad), min(height, bottom + pad)


def sheet(items: list, box: tuple, backdrop: tuple) -> Image.Image:
    columns = min(COLUMNS, len(items))
    rows = -(-len(items) // columns)
    width, height = CELL
    board = Image.new("RGB", (columns * width, rows * (height + LABEL)), (255, 255, 255))
    draw = ImageDraw.Draw(board)
    title, small = tools.font(17), tools.font(14)
    crop_w, crop_h = box[2] - box[0], box[3] - box[1]
    ratio = min((width - 6) / crop_w, (height - 6) / crop_h)
    size = (max(1, round(crop_w * ratio)), max(1, round(crop_h * ratio)))
    for index, item in enumerate(items):
        left, top = (index % columns) * width, (index // columns) * (height + LABEL)
        draw.text((left + 5, top + 3), f"#{item['n']} {item['label']}", fill=(20, 20, 20), font=title)
        tile = Image.new("RGBA", (width, height), (*backdrop, 255) if "error" not in item else (150, 150, 150, 255))
        if "error" in item:
            ImageDraw.Draw(tile).text((10, height // 2 - 10), "失败", fill=(255, 255, 255), font=title)
        else:
            draw.text((left + 5, top + 23), f"bg {item['bg_like'] * 100:.1f}%  opaque {item['opaque'] * 100:.1f}%",
                      fill=(90, 90, 90), font=small)
            with Image.open(item["file"]) as cutout:
                view = tools.premultiplied_resize(cutout.convert("RGBA").crop(box), size)
            tile.alpha_composite(view, ((width - size[0]) // 2, (height - size[1]) // 2))
        board.paste(tile.convert("RGB"), (left, top + LABEL))
    return board


def run(args) -> dict:
    work = Path(args.work)
    raw_dir, clean_dir = work / "raw", work / "clean"
    for directory in (raw_dir, clean_dir):
        directory.mkdir(parents=True, exist_ok=True)
        for old in directory.glob("*.png"):
            old.unlink()
    command = ["rmbg", args.image, "--all", "--out", str(raw_dir)]
    if args.job:
        command += ["--job", args.job, "--step", args.step]
    removed = run_aidraw(*command)
    if not removed.get("ok"):
        return {"ok": False, "error": removed.get("error", "抠图失败")}
    source = tools.load(args.image)
    backdrop = tools.border_color(source)
    items = []
    for n, result in enumerate(removed["results"], start=1):
        item = {"n": n, "variant": result["variant"], "label": result["label"]}
        if "error" in result:
            item["error"] = result["error"]
        else:
            image = clean(tools.load(result["file"]))
            item["file"] = tools.save(image, clean_dir / f"{result['variant']}.png")
            item["raw"], item["seconds"] = result["file"], result.get("seconds")
            item["bg_like"] = bg_like(image, backdrop)
            item["opaque"] = round(image.getchannel("A").histogram()[255] / (image.width * image.height), 4)
        items.append(item)
    done = [item for item in items if "error" not in item]
    images = [tools.load(item["file"]) for item in done]
    box = view_box(images)
    compare = tools.save(sheet(items, box, tools.parse_color(args.bg)), work / "compare.png")
    compare_dark = tools.save(sheet(items, box, (24, 26, 30)), work / "compare_dark.png")
    result = {"ok": True, "image": args.image, "backdrop": "#%02x%02x%02x" % backdrop, "compare": compare,
              "compare_dark": compare_dark, "variants": items}
    (work / "compare.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.job:
        record = {"ts": datetime.now().astimezone().isoformat(timespec="seconds"), "event": "cutout_compare", "step": args.step,
                  "image": args.image, "compare": compare, "failed": [item["variant"] for item in items if "error" in item]}
        with open(args.job, "a", encoding="utf-8") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ai-draw 的全部背景处理算法各抠一次，统一清理后拼成对比图")
    parser.add_argument("image", help="要抠的图（动画用基础帧或第一帧）")
    parser.add_argument("--work", required=True, help="输出目录：raw/、clean/、compare.png、compare_dark.png、compare.json")
    parser.add_argument("--bg", default="#ff00ff", help="对比图底色，默认品红：残留的白底和被抠掉的部分都很显眼")
    parser.add_argument("--job", help="任务日志")
    parser.add_argument("--step", default="cutout-compare")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run(args)
    except (OSError, ValueError) as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
