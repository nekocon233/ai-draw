#!/usr/bin/env python3
"""Phaser asset packs and the project's art spec (art/spec.json).

The spec records, per texture key, what the game expects: file, exact size, anchor, facing, alpha,
layer, tiling and the code constants tied to the art, plus its status (placeholder / generated / final).
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sprite_tools import seam_score  # noqa: E402

STATUSES = ("placeholder", "generated", "final")


def read_json(path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data: dict, indent: int) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


def pack_entries(pack: dict):
    for section, content in pack.items():
        if section == "meta" or not isinstance(content, dict):
            continue
        for entry in content.get("files", []):
            yield section, entry


def image_facts(path: Path) -> dict:
    with Image.open(path) as image:
        return {"width": image.width, "height": image.height, "mode": image.mode,
                "has_alpha": image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info}


def cmd_list(args):
    pack = read_json(args.pack)
    return {"ok": True, "entries": [{"section": section, **entry} for section, entry in pack_entries(pack)]}


def cmd_register(args):
    """Add or update one entry, keeping the pack's 4-space layout; existing keys are updated in place."""
    pack = read_json(args.pack)
    entry = {"url": args.url, "type": args.type, "key": args.key}
    if args.type == "spritesheet":
        if not (args.frame_width and args.frame_height):
            return {"ok": False, "error": "spritesheet 需要 --frame-width 和 --frame-height"}
        entry["frameConfig"] = {"frameWidth": args.frame_width, "frameHeight": args.frame_height}
        if args.end_frame is not None:
            entry["frameConfig"]["endFrame"] = args.end_frame
    if args.type == "atlas":
        entry = {"type": "atlas", "key": args.key, "textureURL": args.url, "atlasURL": args.atlas_url}
    for section, existing in pack_entries(pack):
        if existing.get("key") == args.key:
            existing.clear()
            existing.update(entry)
            write_json(args.pack, pack, 4)
            return {"ok": True, "action": "updated", "section": section, "entry": entry}
    pack.setdefault(args.section, {"files": []}).setdefault("files", []).append(entry)
    if "meta" in pack:
        # Keep meta last, as Phaser Editor writes it.
        pack["meta"] = pack.pop("meta")
    write_json(args.pack, pack, 4)
    return {"ok": True, "action": "added", "section": args.section, "entry": entry}


def cmd_spec_init(args):
    """Seed a spec from the image entries of a pack; the agent then annotates anchors, facing and code refs."""
    pack = read_json(args.pack)
    root = Path(args.root)
    existing = read_json(args.out).get("assets", {}) if Path(args.out).exists() else {}
    assets = {}
    for section, entry in pack_entries(pack):
        if entry.get("type") != "image":
            continue
        path = root / entry["url"]
        if not path.exists():
            continue
        facts = image_facts(path)
        assets[entry["key"]] = existing.get(entry["key"]) or {
            "path": str(path),
            "section": section,
            "size": {"w": facts["width"], "h": facts["height"]},
            "alpha": facts["has_alpha"],
            "status": "placeholder",
            "ai": True,
            "notes": "",
        }
    spec = {"version": 1, "project": args.project, "assets": assets}
    if Path(args.out).exists():
        spec = {**read_json(args.out), "assets": assets}
    write_json(args.out, spec, 2)
    return {"ok": True, "out": args.out, "count": len(assets)}


def cmd_spec_set(args):
    spec = read_json(args.spec)
    asset = spec.setdefault("assets", {}).get(args.key)
    if asset is None:
        return {"ok": False, "error": f"规格里没有 {args.key}"}
    for item in args.fields:
        name, _, value = item.partition("=")
        try:
            parsed = json.loads(value)
        except ValueError:
            parsed = value
        if name == "status" and parsed not in STATUSES:
            return {"ok": False, "error": f"status 只能是 {'/'.join(STATUSES)}"}
        asset[name] = parsed
    asset["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(args.spec, spec, 2)
    return {"ok": True, "key": args.key, "asset": asset}


def check_animation(path: Path, asset: dict, entry, facts: dict, result: dict) -> list:
    """A sprite sheet: the spec's size is one frame. Blank cells may only follow the last frame, and the pack must
    stop Phaser before them (frameConfig.endFrame), or the sprite vanishes for those frames on every loop."""
    problems = []
    size = asset.get("size") or {}
    width, height, frames = size.get("w"), size.get("h"), asset.get("frames")
    if not (isinstance(width, int) and isinstance(height, int) and isinstance(frames, int)):
        return ["动画规格要写单帧尺寸 size.w/size.h 和帧数 frames"]
    if facts["width"] % width or facts["height"] % height:
        return [f"图集 {facts['width']}×{facts['height']} 不是单帧 {width}×{height} 的整数倍"]
    columns = facts["width"] // width
    cells = columns * (facts["height"] // height)
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        blank = [index for index in range(cells) if alpha.crop(
            ((index % columns) * width, (index // columns) * height,
             (index % columns + 1) * width, (index // columns + 1) * height)).getbbox() is None]
    result.update(frames=frames, cells=cells, blank_cells=blank)
    if frames > cells:
        problems.append(f"规格写了 {frames} 帧，图集只有 {cells} 格")
    if [index for index in blank if index < frames]:
        problems.append(f"第 {', '.join(str(index) for index in blank if index < frames)} 格是空的（在最后一帧之前）")
    config = (entry or {}).get("frameConfig") or {}
    if entry is not None:
        if (config.get("frameWidth"), config.get("frameHeight")) != (width, height):
            problems.append(f"asset pack 的帧尺寸是 {config.get('frameWidth')}×{config.get('frameHeight')}，规格是 {width}×{height}")
        if config.get("endFrame", cells - 1) != frames - 1:
            problems.append(f"asset pack 的 endFrame 应为 {frames - 1}（现在 {config.get('endFrame', '未写，按全部 ' + str(cells) + ' 格')}）")
    return problems


def check_asset(key: str, asset: dict, root: Path, registered: dict) -> dict:
    problems = []
    path = Path(asset["path"])
    path = path if path.is_absolute() else root / path
    result = {"key": key, "status": asset.get("status"), "problems": problems}
    if not path.exists():
        problems.append(f"文件不存在：{asset['path']}")
        return result
    facts = image_facts(path)
    result.update(width=facts["width"], height=facts["height"], mode=facts["mode"])
    size = asset.get("size") or {}
    if asset.get("kind") == "animation":
        problems.extend(check_animation(path, asset, registered.get(key), facts, result))
    else:
        if isinstance(size.get("w"), int) and size["w"] != facts["width"]:
            problems.append(f"宽 {facts['width']}，规格要求 {size['w']}")
        if isinstance(size.get("h"), int) and size["h"] != facts["height"]:
            problems.append(f"高 {facts['height']}，规格要求 {size['h']}")
    if asset.get("alpha") is True and not facts["has_alpha"]:
        problems.append("规格要求透明通道，文件没有")
    if asset.get("tile_x"):
        with Image.open(path) as image:
            score = seam_score(image)
        result["seam_score_x"] = score
        if score > 1.8:
            problems.append(f"横向接缝明显（分数 {score}）")
    entry = registered.get(key)
    if entry is None:
        problems.append("没有登记在 asset pack 里")
    elif entry.get("url") and not str(asset["path"]).endswith(str(entry["url"])):
        problems.append(f"asset pack 里的地址是 {entry['url']}")
    return result


def cmd_check(args):
    spec = read_json(args.spec)
    registered = {}
    for pack_path in args.pack or []:
        for _, entry in pack_entries(read_json(pack_path)):
            registered[entry.get("key")] = entry
    keys = args.keys or list(spec.get("assets", {}))
    results = [check_asset(key, spec["assets"][key], Path(args.root), registered) for key in keys if key in spec.get("assets", {})]
    missing = [key for key in keys if key not in spec.get("assets", {})]
    ok = not missing and all(not item["problems"] for item in results)
    return {"ok": ok, "results": results, "unknown_keys": missing}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Phaser asset pack 与项目美术规格")
    commands = parser.add_subparsers(dest="command", required=True)

    def add(name, handler, help_text):
        sub = commands.add_parser(name, help=help_text, description=help_text)
        sub.set_defaults(handler=handler)
        return sub

    listing = add("list", cmd_list, "列出 asset pack 条目")
    listing.add_argument("pack")

    register = add("register", cmd_register, "登记或更新一个条目")
    register.add_argument("pack")
    register.add_argument("--key", required=True)
    register.add_argument("--url", required=True, help="相对 public/ 的地址，如 assets/characters/heroine.png")
    register.add_argument("--type", choices=("image", "spritesheet", "atlas"), default="image")
    register.add_argument("--section", default="section1")
    register.add_argument("--frame-width", type=int)
    register.add_argument("--frame-height", type=int)
    register.add_argument("--end-frame", type=int)
    register.add_argument("--atlas-url")

    init = add("spec-init", cmd_spec_init, "从 asset pack 生成规格骨架（已存在的条目保留）")
    init.add_argument("--pack", required=True)
    init.add_argument("--root", required=True, help="asset pack 地址的根目录，通常是 public")
    init.add_argument("--project", required=True)
    init.add_argument("-o", "--out", required=True)

    spec_set = add("spec-set", cmd_spec_set, "修改规格字段，如 status=final")
    spec_set.add_argument("spec")
    spec_set.add_argument("key")
    spec_set.add_argument("fields", nargs="+", help="name=value，value 可以是 JSON")

    check = add("check", cmd_check, "按规格检查文件、尺寸、透明度、接缝和登记")
    check.add_argument("--spec", required=True)
    check.add_argument("--root", default=".", help="规格里相对路径的根目录（项目根）")
    check.add_argument("--pack", action="append")
    check.add_argument("keys", nargs="*")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = args.handler(args)
    except (OSError, ValueError, KeyError) as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
