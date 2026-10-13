#!/usr/bin/env python3
"""Game sprite post-processing with Pillow only (no numpy).

Every command prints one JSON object to stdout. Typical order for a character or prop:
    info → cutout_compare.py (aidraw rmbg, every algorithm) → clean-alpha → defringe → fit → checker/mock (preview) → deliver
Backgrounds are removed by ai-draw's algorithms only. There is deliberately no colour key here: keying from the border
cannot reach background enclosed by the subject, such as the gap between an arm and the body.
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
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


def solve_linear(matrix: list, vector: list) -> list:
    """Gaussian elimination with partial pivoting (no numpy on this host)."""
    size = len(vector)
    rows = [list(row) + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(rows[row][column]))
        if abs(rows[pivot][column]) < 1e-12:
            raise ValueError("四个角点退化，无法做透视校正")
        rows[column], rows[pivot] = rows[pivot], rows[column]
        for row in range(size):
            if row != column:
                factor = rows[row][column] / rows[column][column]
                for index in range(column, size + 1):
                    rows[row][index] -= factor * rows[column][index]
    return [rows[index][size] / rows[index][index] for index in range(size)]


def perspective_coefficients(target: list, source: list) -> list:
    """Coefficients for Image.transform(PERSPECTIVE): for each output pixel, where to sample the input."""
    matrix, vector = [], []
    for (x, y), (u, v) in zip(target, source):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        vector.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        vector.append(v)
    return solve_linear(matrix, vector)


def outline_corners(alpha: Image.Image, erode: int) -> list:
    """Corners of a roughly quadrilateral opaque shape: top-left, top-right, bottom-right, bottom-left.

    Thin strokes sticking out are eroded away first; the corners are then pushed back out by the same amount.
    """
    mask = alpha.point(lambda value: 255 if value > 128 else 0)
    if erode > 1:
        mask = mask.filter(ImageFilter.MinFilter(erode if erode % 2 else erode + 1))
    extremes = {"tl": None, "tr": None, "br": None, "bl": None}
    for y in range(mask.height):
        box = mask.crop((0, y, mask.width, y + 1)).getbbox()
        if box is None:
            continue
        left, right = box[0], box[2] - 1
        for name, value, point in (("tl", left + y, (left, y)), ("bl", left - y, (left, y))):
            if extremes[name] is None or value < extremes[name][0]:
                extremes[name] = (value, point)
        for name, value, point in (("tr", right - y, (right, y)), ("br", right + y, (right, y))):
            if extremes[name] is None or value > extremes[name][0]:
                extremes[name] = (value, point)
    if any(value is None for value in extremes.values()):
        raise ValueError("没有找到不透明的轮廓，先抠掉背景")
    corners = [extremes[name][1] for name in ("tl", "tr", "br", "bl")]
    cx = sum(x for x, _ in corners) / 4
    cy = sum(y for _, y in corners) / 4
    grow = erode // 2 + 1
    expanded = []
    for x, y in corners:
        dx, dy = x - cx, y - cy
        length = math.hypot(dx, dy) or 1
        expanded.append((x + dx / length * grow * math.sqrt(2), y + dy / length * grow * math.sqrt(2)))
    return expanded


def cmd_rectify(args):
    """Straighten a flat object drawn with slight perspective (window, door, notice board) into an upright rectangle."""
    image = load(args.file)
    if args.corners:
        corners = [tuple(float(value) for value in point.split(",")) for point in args.corners.split(";")]
        if len(corners) != 4:
            return {"ok": False, "error": "--corners 需要 4 个点：左上;右上;右下;左下"}
    else:
        if image.getchannel("A").getextrema() == (255, 255):
            return {"ok": False, "error": "图片没有透明背景，先用 aidraw rmbg 抠掉背景，或者用 --corners 指定四个角"}
        corners = outline_corners(image.getchannel("A"), args.erode)
    tl, tr, br, bl = corners
    if args.size:
        width, height = parse_size(args.size)
    else:
        width = round((math.dist(tl, tr) + math.dist(bl, br)) / 2)
        height = round((math.dist(tl, bl) + math.dist(tr, br)) / 2)
    coefficients = perspective_coefficients([(0, 0), (width, 0), (width, height), (0, height)], [tl, tr, br, bl])
    result = image.convert("RGBa").transform(
        (width, height), Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BICUBIC,
    ).convert("RGBA")
    return {"ok": True, "out": save(result, args.out), "size": [width, height],
            "corners": [[round(x, 1), round(y, 1)] for x, y in corners]}


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


def clean_alpha_image(image: Image.Image, threshold: int, opening: int) -> Image.Image:
    alpha = image.getchannel("A").point(lambda value: 0 if value < threshold else value)
    if opening > 1:
        size = opening if opening % 2 else opening + 1
        alpha = ImageChops.darker(alpha, alpha.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size)))
    result = image.copy()
    result.putalpha(alpha)
    return result


def defringe_image(image: Image.Image, radius: int, passes: int) -> Image.Image:
    alpha = image.getchannel("A")
    solid = alpha.point(lambda value: 255 if value >= 250 else 0)
    bled = image.copy()
    bled.putalpha(solid)
    for _ in range(passes):
        spread = bled.convert("RGBa").filter(ImageFilter.BoxBlur(radius)).convert("RGBA")
        known = bled.getchannel("A")
        bled = Image.composite(bled, spread, known.point(lambda value: 255 if value >= 250 else 0))
        bled.putalpha(ImageChops.lighter(known, spread.getchannel("A").point(lambda value: 255 if value > 0 else 0)))
    result = Image.composite(bled, image, solid.point(lambda value: 255 - value))
    result.putalpha(alpha)
    return result


def frame_paths(directory: Path, stem: str = "frame") -> list:
    return sorted(directory.glob(f"{stem}_*.png"))


def probe_fps(video: str):
    """The clip's frame rate (ffprobe), or None."""
    if not shutil.which("ffprobe"):
        return None
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
                             "-of", "default=noprint_wrappers=1:nokey=1", video], capture_output=True, text=True)
    numerator, _, denominator = result.stdout.strip().partition("/")
    try:
        value = float(numerator) / float(denominator or 1)
    except ValueError:
        return None
    return value if value > 0 else None


def cmd_extract(args):
    """Video → numbered PNG frames (fps, optional start/end in seconds).

    Every frame of the range is decoded at the clip's own rate and frames are then picked by frame number: ffmpeg's
    fps filter resamples by timestamp and can repeat one frame and skip the next.
    """
    if not shutil.which("ffmpeg"):
        return {"ok": False, "error": "需要 ffmpeg"}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in frame_paths(out):
        old.unlink()
    command = ["ffmpeg", "-v", "error", "-nostdin", "-y"]
    if args.start is not None:
        command += ["-ss", str(args.start)]
    command += ["-i", args.video]
    if args.end is not None:
        command += ["-to", str(args.end - (args.start or 0))]
    source_fps = probe_fps(args.video)
    if source_fps is None:
        command += ["-vf", f"fps={args.fps}", "-start_number", "0", str(out / "frame_%03d.png")]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip()[-400:]}
        return {"ok": True, "out": str(out), "frames": len(frame_paths(out)), "fps": args.fps}
    with tempfile.TemporaryDirectory() as directory:
        decoded_pattern = str(Path(directory) / "frame_%05d.png")
        result = subprocess.run(command + ["-fps_mode", "passthrough", "-start_number", "0", decoded_pattern],
                                capture_output=True, text=True)
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip()[-400:]}
        decoded = sorted(Path(directory).glob("frame_*.png"))
        step = source_fps / args.fps if args.fps and args.fps < source_fps else 1.0
        picks = [index for index in (round(k * step) for k in range(math.ceil(len(decoded) / step))) if index < len(decoded)]
        for number, index in enumerate(picks):
            shutil.move(str(decoded[index]), out / f"frame_{number:03d}.png")
    return {"ok": True, "out": str(out), "frames": len(picks), "fps": args.fps, "source_fps": source_fps, "source_frames": picks}


def union_bbox(images: list, threshold: int = 8):
    boxes = [alpha_bbox(image, threshold) for image in images]
    boxes = [box for box in boxes if box]
    if not boxes:
        return None
    return (min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes))


def cmd_crop_frames(args):
    """Crop every frame with ONE box and scale them all alike, so feet and centre never jump between frames.

    --box x0,y0,x1,y1 gives the box in source pixels; otherwise it is the union of all alpha bounding boxes
    plus --pad. --height scales the box to that output height (same factor for every frame)."""
    images = [load(path) for path in args.files]
    if args.box:
        box = tuple(int(value) for value in args.box.split(","))
    else:
        union = union_bbox(images)
        if union is None:
            return {"ok": False, "error": "所有帧都是透明的"}
        box = (union[0] - args.pad, union[1] - args.pad, union[2] + args.pad, union[3] + args.pad)
    width, height = box[2] - box[0], box[3] - box[1]
    scale = (args.height / height) if args.height else 1.0
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    feet = []
    for path, image in zip(args.files, images):
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        composite_at(canvas, image, -box[0], -box[1])
        frame = premultiplied_resize(canvas, size) if scale != 1.0 else canvas
        save(frame, out / Path(path).name)
        bbox = alpha_bbox(frame, 8)
        feet.append(bbox[3] if bbox else None)
    known = [value for value in feet if value is not None]
    return {"ok": True, "out": str(out), "frames": len(images), "box": list(box), "size": list(size), "scale": round(scale, 5),
            "feet_bottom": [min(known), max(known)] if known else None}


def frame_difference(a: Image.Image, b: Image.Image) -> float:
    histogram = ImageChops.difference(a, b).histogram()
    return sum(index * count for index, count in enumerate(histogram)) / max(1, a.width * a.height)


def cmd_loop_scan(args):
    """Rank start/end pairs whose frames look most alike: good places to cut a seamless loop."""
    thumbs = []
    for path in args.files:
        image = load(path)
        board = Image.new("RGBA", image.size, (255, 255, 255, 255))
        board.alpha_composite(image)
        thumbs.append(board.convert("L").resize((64, max(1, round(64 * image.height / image.width))), Image.Resampling.BILINEAR))
    count = len(thumbs)
    steps = [frame_difference(thumbs[index], thumbs[index + 1]) for index in range(count - 1)]
    typical = max(sum(steps) / max(1, len(steps)), 0.01)
    pairs = []
    for start in range(count):
        for end in range(start + args.min_length - 1, count):
            # A loop start..end plays end → start next; that jump should look like one ordinary step.
            pairs.append((frame_difference(thumbs[end], thumbs[start]) / typical, start, end))
    pairs.sort()
    best = [{"start": start, "end": end, "length": end - start + 1, "jump": round(score, 2)} for score, start, end in pairs[: args.top]]
    return {"ok": True, "frames": count, "typical_step": round(typical, 3), "max_step": round(max(steps) / typical, 2) if steps else 0, "best": best}


def cmd_pack_sheet(args):
    """Equal-size frames → one sprite sheet (row-major grid) plus JSON with Phaser's frameConfig."""
    frames = [load(path) for path in args.files]
    width, height = frames[0].size
    if any(frame.size != (width, height) for frame in frames):
        return {"ok": False, "error": "所有帧必须同样大小（先用 crop-frames）"}
    columns = args.columns or max(1, min(len(frames), args.max_width // width))
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGBA", (columns * width, rows * height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.paste(frame, ((index % columns) * width, (index // columns) * height))
    out = save(sheet, args.out)
    meta = {"frameWidth": width, "frameHeight": height, "frames": len(frames), "columns": columns, "rows": rows,
            "sheet": [sheet.width, sheet.height]}
    if args.json:
        Path(args.json).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "out": out, **meta}


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

    rectify = add("rectify", cmd_rectify, "透视校正：把略带透视或倾斜的平面物体（窗、门、告示牌）拉成正交的矩形")
    rectify.add_argument("file", help="已抠掉背景的图（按 alpha 外轮廓找四个角）")
    rectify.add_argument("-o", "--out", required=True)
    rectify.add_argument("--corners", help="手动指定四个角：x,y;x,y;x,y;x,y（左上;右上;右下;左下）")
    rectify.add_argument("--erode", type=int, default=7, help="找角前先腐蚀掉的细线宽度")
    rectify.add_argument("--size", help="输出 宽x高；默认按四条边的平均长度")

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

    extract = add("extract", cmd_extract, "用 ffmpeg 把视频抽成 frame_000.png 这样编号的帧")
    extract.add_argument("video")
    extract.add_argument("-o", "--out", required=True, help="输出目录（会清掉其中旧的 frame_*.png）")
    extract.add_argument("--fps", type=float, default=12)
    extract.add_argument("--start", type=float, help="起始秒")
    extract.add_argument("--end", type=float, help="结束秒")

    crop = add("crop-frames", cmd_crop_frames, "所有帧用同一个框裁切、同一个比例缩放，脚底和中线不跳")
    crop.add_argument("files", nargs="+")
    crop.add_argument("-o", "--out", required=True, help="输出目录")
    crop.add_argument("--box", help="源图坐标 x0,y0,x1,y1；不给则取所有帧 alpha 外框的并集")
    crop.add_argument("--pad", type=int, default=8)
    crop.add_argument("--height", type=int, help="输出高度（所有帧同一缩放比例）")

    loop = add("loop-scan", cmd_loop_scan, "找首尾最像的循环区间（jump 越接近 1 越无缝）")
    loop.add_argument("files", nargs="+")
    loop.add_argument("--min-length", type=int, default=8)
    loop.add_argument("--top", type=int, default=8)

    pack = add("pack-sheet", cmd_pack_sheet, "等大的帧打包成精灵图，并输出 Phaser frameConfig")
    pack.add_argument("files", nargs="+")
    pack.add_argument("-o", "--out", required=True)
    pack.add_argument("--json", help="同时写出帧信息 JSON")
    pack.add_argument("--columns", type=int)
    pack.add_argument("--max-width", type=int, default=4096)

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
