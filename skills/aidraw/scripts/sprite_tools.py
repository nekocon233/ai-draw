#!/usr/bin/env python3
"""Game sprite post-processing with Pillow only (no numpy).

Every command prints one JSON object to stdout. Typical order for a character or prop:
    info → key/rmbg → clean-alpha → defringe → fit → checker/mock (preview) → deliver
"""
import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont

CHECKER_LIGHT = (236, 236, 236, 255)
CHECKER_DARK = (204, 204, 204, 255)


# ---------------------------------------------------------------- helpers

def load(path) -> Image.Image:
    with Image.open(path) as image:
        image.load()
        return image.convert("RGBA")


def save(image: Image.Image, path) -> str:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    return str(target)


def parse_color(text: str) -> tuple:
    if text.lower().startswith("0x"):
        text = "#" + text[2:]
    return ImageColor.getrgb(text)[:3]


def parse_size(text: str) -> tuple[int, int]:
    width, height = (int(part) for part in text.lower().split("x"))
    return width, height


def alpha_bbox(image: Image.Image, threshold: int = 0):
    alpha = image.getchannel("A")
    if threshold:
        alpha = alpha.point(lambda value: 255 if value > threshold else 0)
    return alpha.getbbox()


def border_color(image: Image.Image) -> tuple:
    """Median colour of the outer one-pixel frame; the usual background of a generated sprite."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = [rgb.getpixel((x, 0)) for x in range(width)] + [rgb.getpixel((x, height - 1)) for x in range(width)]
    pixels += [rgb.getpixel((0, y)) for y in range(height)] + [rgb.getpixel((width - 1, y)) for y in range(height)]
    return tuple(sorted(channel)[len(channel) // 2] for channel in zip(*pixels))


def max_channel_difference(image: Image.Image, color: tuple) -> Image.Image:
    difference = ImageChops.difference(image.convert("RGB"), Image.new("RGB", image.size, color))
    red, green, blue = difference.split()
    return ImageChops.lighter(ImageChops.lighter(red, green), blue)


def premultiplied_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize without dark or light halos: colour is weighted by alpha while filtering."""
    return image.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, CHECKER_LIGHT)
    draw = ImageDraw.Draw(board)
    for top in range(0, size[1], cell):
        for left in range((top // cell) % 2 * cell, size[0], cell * 2):
            draw.rectangle((left, top, left + cell - 1, top + cell - 1), fill=CHECKER_DARK)
    return board


def seam_score(image: Image.Image) -> float:
    """How much the right edge differs from the left edge, relative to ordinary neighbouring columns.

    About 1 means the wrap looks like any other column step (seamless); clearly above 2 shows a visible seam.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width < 3:
        return 0.0

    def column_difference(a: int, b: int) -> float:
        left = rgb.crop((a, 0, a + 1, height))
        right = rgb.crop((b, 0, b + 1, height))
        histogram = ImageChops.difference(left, right).convert("L").histogram()
        return sum(index * count for index, count in enumerate(histogram)) / max(1, height)

    samples = [column_difference(x, x + 1) for x in range(0, width - 1, max(1, width // 64))]
    typical = max(sum(samples) / len(samples), 0.5)
    return round(column_difference(width - 1, 0) / typical, 2)


def font(size: int):
    for candidate in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- commands

def cmd_info(args):
    results = []
    for path in args.files:
        with Image.open(path) as original:
            mode, frames, image_format = original.mode, int(getattr(original, "n_frames", 1) or 1), original.format
        image = load(path)
        alpha = image.getchannel("A")
        histogram = alpha.histogram()
        total = image.width * image.height
        corners = [image.getpixel(point)[3] for point in ((0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1))]
        results.append({
            "file": str(path),
            "format": image_format,
            "mode": mode,
            "width": image.width,
            "height": image.height,
            "frames": frames,
            "alpha_bbox": alpha_bbox(image, 8),
            "transparent_ratio": round(sum(histogram[:9]) / total, 3),
            "opaque_ratio": round(histogram[255] / total, 3),
            "corner_alpha": corners,
            "background_guess": "#%02x%02x%02x" % border_color(image),
            "seam_score_x": seam_score(image),
        })
    return {"ok": True, "files": results}


def cmd_flatten(args):
    image = load(args.file)
    background = Image.new("RGBA", image.size, (*parse_color(args.color), 255))
    background.alpha_composite(image)
    return {"ok": True, "out": save(background.convert("RGB"), args.out)}


def cmd_key(args):
    """Make the background transparent where it touches the border: a flat colour key that leaves
    same-coloured areas inside the subject alone."""
    image = load(args.file)
    color = border_color(image) if args.color == "auto" else parse_color(args.color)
    far = max_channel_difference(image, color).point(lambda value: 255 if value > args.tolerance else 0)
    width, height = far.size
    seeds = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    seeds += [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)]
    for seed in seeds:
        if far.getpixel(seed) == 0:
            ImageDraw.floodfill(far, seed, 128)
    background = far.point(lambda value: 255 if value == 128 else 0)
    keep = ImageChops.invert(background)
    if args.feather:
        keep = ImageChops.darker(keep, keep.filter(ImageFilter.GaussianBlur(args.feather)))
    alpha = ImageChops.multiply(image.getchannel("A"), keep)
    image.putalpha(alpha)
    removed = background.histogram()[255] / (width * height)
    return {"ok": True, "out": save(image, args.out), "color": "#%02x%02x%02x" % color, "removed_ratio": round(removed, 3)}


def cmd_clean_alpha(args):
    image = load(args.file)
    alpha = image.getchannel("A").point(lambda value: 0 if value < args.threshold else value)
    if args.open > 1:
        size = args.open if args.open % 2 else args.open + 1
        opened = alpha.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size))
        alpha = ImageChops.darker(alpha, opened)
    image.putalpha(alpha)
    return {"ok": True, "out": save(image, args.out), "alpha_bbox": alpha_bbox(image, 8)}


def cmd_defringe(args):
    """Replace the colour of edge and transparent pixels with nearby opaque colour (alpha bleed),
    so a background tint cannot leak into resized or filtered edges."""
    image = load(args.file)
    alpha = image.getchannel("A")
    solid = alpha.point(lambda value: 255 if value >= 250 else 0)
    source = image.copy()
    source.putalpha(solid)
    bled = source
    for _ in range(args.passes):
        spread = bled.convert("RGBa").filter(ImageFilter.BoxBlur(args.radius)).convert("RGBA")
        known = bled.getchannel("A")
        bled = Image.composite(bled, spread, known.point(lambda value: 255 if value >= 250 else 0))
        bled.putalpha(ImageChops.lighter(known, spread.getchannel("A").point(lambda value: 255 if value > 0 else 0)))
    edge = solid.point(lambda value: 255 - value)
    result = Image.composite(bled, image, edge)
    result.putalpha(alpha)
    return {"ok": True, "out": save(result, args.out)}


def cmd_trim(args):
    image = load(args.file)
    box = alpha_bbox(image, args.threshold)
    if box is None:
        return {"ok": False, "error": "图片完全透明"}
    left, top, right, bottom = box
    pad = args.pad
    canvas = Image.new("RGBA", (right - left + 2 * pad, bottom - top + 2 * pad), (0, 0, 0, 0))
    canvas.alpha_composite(image.crop(box), (pad, pad))
    return {"ok": True, "out": save(canvas, args.out), "bbox": box, "size": canvas.size}


def composite_at(canvas: Image.Image, sprite: Image.Image, x: int, y: int) -> None:
    """alpha_composite that also accepts positions partly outside the canvas."""
    left, top = max(0, -x), max(0, -y)
    right, bottom = min(sprite.width, canvas.width - x), min(sprite.height, canvas.height - y)
    if right > left and bottom > top:
        canvas.alpha_composite(sprite.crop((left, top, right, bottom)), (x + left, y + top))


def place(sprite: Image.Image, size: tuple[int, int], anchor: str, offset_x: int = 0) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - sprite.width) // 2 + offset_x
    y = {"bottom": size[1] - sprite.height, "top": 0}.get(anchor, (size[1] - sprite.height) // 2)
    composite_at(canvas, sprite, x, y)
    return canvas


def cmd_fit(args):
    """Scale to the delivery size. --height keeps the character's height exact (feet on the bottom edge);
    --box fits a prop into an exact texture (contain, cover or stretch)."""
    image = load(args.file)
    if args.trim:
        box = alpha_bbox(image, 8)
        if box:
            image = image.crop(box)
    if args.height:
        inner = args.height - args.pad
        width = max(1, round(image.width * inner / image.height))
        sprite = premultiplied_resize(image, (width, inner))
        canvas_width = parse_size(args.canvas)[0] if args.canvas else width + 2 * args.side_pad
        canvas_height = parse_size(args.canvas)[1] if args.canvas else args.height
        result = place(sprite, (canvas_width, canvas_height), args.anchor, args.offset_x)
    elif args.box:
        target = parse_size(args.box)
        if args.mode == "stretch":
            result = premultiplied_resize(image, target)
        else:
            ratio = (max if args.mode == "cover" else min)(target[0] / image.width, target[1] / image.height)
            scaled = premultiplied_resize(image, (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))))
            if args.mode == "cover":
                left = (scaled.width - target[0]) // 2
                top = scaled.height - target[1] if args.anchor == "bottom" else (scaled.height - target[1]) // 2
                result = scaled.crop((left, top, left + target[0], top + target[1]))
            else:
                result = place(scaled, target, args.anchor, args.offset_x)
    else:
        raise SystemExit("需要 --height 或 --box")
    if args.sharpen:
        rgb = result.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1, percent=args.sharpen, threshold=2))
        rgb.putalpha(result.getchannel("A"))
        result = rgb
    return {"ok": True, "out": save(result, args.out), "size": result.size, "alpha_bbox": alpha_bbox(result, 8)}


def cmd_canvas(args):
    image = load(args.file)
    result = place(image, parse_size(args.size), args.anchor, args.offset_x)
    return {"ok": True, "out": save(result, args.out), "size": result.size}


def cmd_checker(args):
    image = load(args.file)
    board = checkerboard(image.size, args.cell)
    board.alpha_composite(image)
    if args.dark:
        dark = Image.new("RGBA", image.size, (24, 26, 30, 255))
        dark.alpha_composite(image)
        both = Image.new("RGBA", (image.width * 2 + 8, image.height), (255, 255, 255, 0))
        both.paste(board, (0, 0))
        both.paste(dark, (image.width + 8, 0))
        board = both
    return {"ok": True, "out": save(board.convert("RGB"), args.out)}


def cmd_contact(args):
    """Numbered sheet of candidates on a checkerboard, so one look covers a whole batch."""
    images = [load(path) for path in args.files]
    cell = args.cell
    columns = args.columns or min(4, len(images))
    rows = math.ceil(len(images) / columns)
    label_height = 28
    sheet = Image.new("RGBA", (columns * cell, rows * (cell + label_height)), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    typeface = font(18)
    for index, image in enumerate(images):
        column, row = index % columns, index // columns
        left, top = column * cell, row * (cell + label_height)
        tile = checkerboard((cell, cell), max(4, cell // 16))
        ratio = min((cell - 8) / image.width, (cell - 8) / image.height)
        scaled = premultiplied_resize(image, (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))))
        tile.alpha_composite(scaled, ((cell - scaled.width) // 2, (cell - scaled.height) // 2))
        sheet.paste(tile, (left, top + label_height))
        label = f"#{index + 1}" + (f"  {Path(args.files[index]).stem}" if args.names else "")
        draw.text((left + 6, top + 4), label, fill=(20, 20, 20, 255), font=typeface)
    return {"ok": True, "out": save(sheet.convert("RGB"), args.out), "count": len(images), "columns": columns}


def light_map(size: tuple[int, int], ambient: tuple, lights: list[tuple]) -> Image.Image:
    """Rough stand-in for the game's MULTIPLY light map: ambient colour plus additive radial pools."""
    lit = Image.new("RGB", size, ambient)
    for x, y, radius, intensity in lights:
        mask = Image.new("L", (radius * 2, radius * 2), 0)
        draw = ImageDraw.Draw(mask)
        steps = 24
        for step in range(steps, 0, -1):
            fraction = step / steps
            value = int(255 * intensity * (1 - fraction) ** 1.6)
            r = int(radius * fraction)
            draw.ellipse((radius - r, radius - r, radius + r, radius + r), fill=value)
        pool = Image.new("RGB", mask.size, (255, 255, 255))
        layer = Image.new("RGB", size, (0, 0, 0))
        layer.paste(pool, (x - radius, y - radius), mask)
        lit = ImageChops.add(lit, layer)
    return lit


def cmd_mock(args):
    """Preview a sprite in place: on a background, unlit and under an approximation of the game lighting."""
    background = load(args.bg) if args.bg else Image.new("RGBA", parse_size(args.size), (120, 124, 130, 255))
    if args.size and args.bg:
        background = background.resize(parse_size(args.size), Image.Resampling.LANCZOS)
    sprite = load(args.sprite)
    if args.height:
        sprite = premultiplied_resize(sprite, (max(1, round(sprite.width * args.height / sprite.height)), args.height))
    if args.flip:
        sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    scene = background.copy()
    x = args.x - sprite.width // 2
    y = args.y - sprite.height if args.anchor == "feet" else args.y - sprite.height // 2
    composite_at(scene, sprite, x, y)
    lights = []
    for text in args.light or []:
        lx, ly, radius, intensity = text.split(",")
        lights.append((int(lx), int(ly), int(radius), float(intensity)))
    if not lights:
        lights = [(args.x, args.y - (sprite.height // 2), max(160, sprite.height), 0.55)]
    lit = ImageChops.multiply(scene.convert("RGB"), light_map(scene.size, parse_color(args.ambient), lights))
    if args.both:
        combined = Image.new("RGB", (scene.width * 2 + 8, scene.height), (255, 255, 255))
        combined.paste(scene.convert("RGB"), (0, 0))
        combined.paste(lit, (scene.width + 8, 0))
        lit = combined
    return {"ok": True, "out": save(lit, args.out)}


def cmd_tile_x(args):
    """Make a strip seamless horizontally by cross-fading the extra width beyond the target into the left edge."""
    image = load(args.file)
    if args.height and image.height != args.height:
        image = premultiplied_resize(image, (max(1, round(image.width * args.height / image.height)), args.height))
    width = args.width
    blend = args.blend
    if image.width < width + blend:
        return {"ok": False, "error": f"源图宽 {image.width}，至少需要 {width + blend}（目标宽 + 融合宽）；请生成更宽的图"}
    result = image.crop((0, 0, width, image.height))
    extra = image.crop((width, 0, width + blend, image.height))
    # 255 on the left: take the extra strip, which is what naturally follows the right edge; 0 on the right.
    ramp = Image.new("L", (blend, 1))
    ramp.putdata([round(255 * (1 - index / max(1, blend - 1))) for index in range(blend)])
    ramp = ramp.resize((blend, image.height))
    left = Image.composite(extra, result.crop((0, 0, blend, image.height)), ramp)
    result.paste(left, (0, 0))
    if args.opaque:
        result = result.convert("RGB")
    return {"ok": True, "out": save(result, args.out), "size": result.size, "seam_score_x": seam_score(result)}


def cmd_seam_check(args):
    image = load(args.file)
    score = seam_score(image)
    payload = {"ok": True, "seam_score_x": score, "seamless": score <= args.max_score}
    if args.out:
        strip = Image.new("RGBA", (image.width * args.repeat, image.height))
        for index in range(args.repeat):
            strip.paste(image, (index * image.width, 0))
        if args.mark:
            draw = ImageDraw.Draw(strip)
            for index in range(1, args.repeat):
                draw.line((index * image.width, 0, index * image.width, 6), fill=(255, 0, 0, 255), width=1)
        payload["out"] = save(strip.convert("RGB"), args.out)
    return payload


def cmd_guides(args):
    """Draw horizontal guide lines (e.g. the wall's trim and baseboard rows) to compare band alignment."""
    image = load(args.file).convert("RGB")
    draw = ImageDraw.Draw(image)
    for value in args.at.split(","):
        y = int(value)
        draw.line((0, y, image.width, y), fill=(255, 0, 80), width=1)
        draw.text((4, max(0, y - 14)), str(y), fill=(255, 0, 80), font=font(12))
    return {"ok": True, "out": save(image, args.out)}


def cmd_anim_preview(args):
    frames = [load(path) for path in args.files]
    size = (max(frame.width for frame in frames), max(frame.height for frame in frames))
    prepared = []
    for frame in frames:
        canvas = checkerboard(size, 8) if args.checker else Image.new("RGBA", size, (0, 0, 0, 0))
        canvas.alpha_composite(frame, ((size[0] - frame.width) // 2, size[1] - frame.height))
        prepared.append(canvas)
    duration = int(1000 / args.fps)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    suffix = target.suffix.lower()
    if suffix == ".gif":
        prepared[0].save(target, save_all=True, append_images=prepared[1:], duration=duration, loop=0, disposal=2)
    elif suffix == ".webp":
        prepared[0].save(target, save_all=True, append_images=prepared[1:], duration=duration, loop=0, lossless=True)
    else:
        prepared[0].save(target, save_all=True, append_images=prepared[1:], duration=duration, loop=0, format="PNG")
    return {"ok": True, "out": str(target), "frames": len(prepared), "size": size}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="游戏素材后处理（只用 Pillow）")
    commands = parser.add_subparsers(dest="command", required=True)

    def add(name, handler, help_text):
        sub = commands.add_parser(name, help=help_text, description=help_text)
        sub.set_defaults(handler=handler)
        return sub

    info = add("info", cmd_info, "尺寸、透明度、背景色猜测和横向接缝分数")
    info.add_argument("files", nargs="+")

    flatten = add("flatten", cmd_flatten, "把透明部分铺到纯色底上")
    flatten.add_argument("file")
    flatten.add_argument("-o", "--out", required=True)
    flatten.add_argument("--color", default="#ffffff")

    key = add("key", cmd_key, "从边缘开始把纯色背景抠成透明（主体内部同色不受影响）")
    key.add_argument("file")
    key.add_argument("-o", "--out", required=True)
    key.add_argument("--color", default="auto", help="背景色，默认取边框颜色")
    key.add_argument("--tolerance", type=int, default=24, help="与背景色的最大通道差")
    key.add_argument("--feather", type=float, default=0.8)

    clean = add("clean-alpha", cmd_clean_alpha, "去掉几乎透明的像素和细小杂点")
    clean.add_argument("file")
    clean.add_argument("-o", "--out", required=True)
    clean.add_argument("--threshold", type=int, default=12)
    clean.add_argument("--open", type=int, default=3, help="形态学开运算核大小，0 关闭")

    defringe = add("defringe", cmd_defringe, "用内部颜色替换边缘颜色，去掉背景色描边")
    defringe.add_argument("file")
    defringe.add_argument("-o", "--out", required=True)
    defringe.add_argument("--radius", type=int, default=2)
    defringe.add_argument("--passes", type=int, default=4)

    trim = add("trim", cmd_trim, "按 alpha 裁掉透明边")
    trim.add_argument("file")
    trim.add_argument("-o", "--out", required=True)
    trim.add_argument("--pad", type=int, default=0)
    trim.add_argument("--threshold", type=int, default=8)

    fit = add("fit", cmd_fit, "缩放到交付尺寸（角色按高度，道具按盒子）")
    fit.add_argument("file")
    fit.add_argument("-o", "--out", required=True)
    fit.add_argument("--height", type=int, help="角色：总高度，脚踩底边")
    fit.add_argument("--box", help="道具：宽x高")
    fit.add_argument("--mode", choices=("contain", "cover", "stretch"), default="contain")
    fit.add_argument("--anchor", choices=("bottom", "center", "top"), default="bottom")
    fit.add_argument("--pad", type=int, default=0, help="--height 时顶部留白")
    fit.add_argument("--side-pad", type=int, default=2, help="--height 时左右留白")
    fit.add_argument("--canvas", help="--height 时指定画布 宽x高")
    fit.add_argument("--offset-x", type=int, default=0)
    fit.add_argument("--no-trim", dest="trim", action="store_false")
    fit.add_argument("--sharpen", type=int, default=0, help="缩小后的锐化强度（百分比），0 关闭")

    canvas = add("canvas", cmd_canvas, "不缩放，放到指定画布上")
    canvas.add_argument("file")
    canvas.add_argument("-o", "--out", required=True)
    canvas.add_argument("--size", required=True)
    canvas.add_argument("--anchor", choices=("bottom", "center", "top"), default="bottom")
    canvas.add_argument("--offset-x", type=int, default=0)

    checker = add("checker", cmd_checker, "棋盘格预览（可加深色底对照）")
    checker.add_argument("file")
    checker.add_argument("-o", "--out", required=True)
    checker.add_argument("--cell", type=int, default=16)
    checker.add_argument("--dark", action="store_true")

    contact = add("contact", cmd_contact, "带编号的候选拼图")
    contact.add_argument("files", nargs="+")
    contact.add_argument("-o", "--out", required=True)
    contact.add_argument("--cell", type=int, default=320)
    contact.add_argument("--columns", type=int)
    contact.add_argument("--names", action="store_true")

    mock = add("mock", cmd_mock, "把素材放进场景，按游戏光照近似预览")
    mock.add_argument("sprite")
    mock.add_argument("-o", "--out", required=True)
    mock.add_argument("--bg", help="背景图；不给则用中灰")
    mock.add_argument("--size", default="1280x720")
    mock.add_argument("--x", type=int, default=640)
    mock.add_argument("--y", type=int, default=578)
    mock.add_argument("--anchor", choices=("feet", "center"), default="feet")
    mock.add_argument("--height", type=int, help="在场景里的显示高度")
    mock.add_argument("--flip", action="store_true")
    mock.add_argument("--ambient", default="#2c313b")
    mock.add_argument("--light", action="append", help="x,y,半径,强度 例如 640,300,260,0.6")
    mock.add_argument("--both", action="store_true", help="左边不打光，右边打光")

    tile = add("tile-x", cmd_tile_x, "横向无缝：把多出的宽度交叉融合到左边")
    tile.add_argument("file")
    tile.add_argument("-o", "--out", required=True)
    tile.add_argument("--width", type=int, required=True)
    tile.add_argument("--height", type=int)
    tile.add_argument("--blend", type=int, default=96)
    tile.add_argument("--opaque", action="store_true", help="输出不带 alpha（墙地天花板）")

    seam = add("seam-check", cmd_seam_check, "接缝分数，并可输出平铺 3 次的预览")
    seam.add_argument("file")
    seam.add_argument("-o", "--out")
    seam.add_argument("--repeat", type=int, default=3)
    seam.add_argument("--max-score", type=float, default=1.8)
    seam.add_argument("--mark", action="store_true")

    guides = add("guides", cmd_guides, "画水平参考线，检查色带位置")
    guides.add_argument("file")
    guides.add_argument("-o", "--out", required=True)
    guides.add_argument("--at", required=True, help="逗号分隔的 y 坐标")

    anim = add("anim-preview", cmd_anim_preview, "把帧做成 GIF / APNG / WebP 预览")
    anim.add_argument("files", nargs="+")
    anim.add_argument("-o", "--out", required=True)
    anim.add_argument("--fps", type=float, default=8)
    anim.add_argument("--checker", action="store_true")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = args.handler(args)
    except (OSError, ValueError) as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
