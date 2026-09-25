"""Prepare the Ameniwa v3 dataset: style-free Chinese captions plus sketch-to-finished edit pairs.

Painting style must come from the LoRA alone, so captions describe content only. Edit pairs teach
the adapter to finish a line sketch into the artist's rendering when prompted with the app preset.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

STYLE_WORDS = re.compile(r'二次元|动漫|插画|画风|风格|平涂|厚涂|赛璐璐|水彩|写实|粗黑|块面')
# Short captions stand in for user prompts, which never describe rendering. Colour gradients of hair
# or nails are content, so 渐变 stays allowed.
RENDERING_WORDS = re.compile(r'线条|轮廓|上色|阴影|光影|明暗|高光|色块|笔触|描边|签名')
SIGNATURE_TAGS = {'signature', 'artist_name', 'watermark', 'twitter_username', 'dated'}
SIGNATURE_NOTE = '画面角落有作者签名。'
# The captioner described the style's purple highlight shapes as a dress pattern.
CAPTION_FIXES = {'GiFLUSJacAAoRE7.jpg': ('，裙上有蓝紫色块', '')}
SKETCH_METHODS = ('manga', 'coarse')
# AI Toolkit caches each edit prompt together with its full-size reference, while training feeds the
# bucket-resized one; the slot counts only agree when pairs are stored at their final bucket size.
EDIT_RESOLUTION, EDIT_DIVISIBILITY = 1024, 64


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def write_once(path, content):
    """Create a file, or confirm an existing one is unchanged; never silently overwrite."""
    data = content.encode('utf-8') if isinstance(content, str) else content
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f'Existing file changed: {path.name}')
        return
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def split_caption(text):
    english, _, chinese = text.strip().partition('\n\n')
    if not chinese.strip():
        raise ValueError('Expected English tags followed by a Chinese paragraph')
    return {tag.strip() for tag in english.split(',')}, ' '.join(chinese.split())


def long_caption(name, text):
    tags, chinese = split_caption(text)
    old, new = CAPTION_FIXES.get(name, ('', ''))
    if old:
        if old not in chinese:
            raise ValueError(f'Caption fix no longer matches: {name}')
        chinese = chinese.replace(old, new)
    if STYLE_WORDS.search(chinese):
        raise ValueError(f'Caption describes painting style: {name}')
    return chinese + (SIGNATURE_NOTE if tags & SIGNATURE_TAGS else '')


def short_caption(value):
    text = ' '.join(value.strip().split()).strip('“”"')
    if not text.endswith('。'):
        text += '。'
    if len(re.findall(r'[㐀-鿿]', text)) < 10 or len(text) > 60:
        raise ValueError('Short caption has an unexpected length')
    if STYLE_WORDS.search(text) or RENDERING_WORDS.search(text) or '```' in text:
        raise ValueError('Short caption must describe content only')
    return text


def with_signature(text, tags):
    return text + (SIGNATURE_NOTE if tags & SIGNATURE_TAGS else '')


def edit_caption(preset, content=''):
    if not preset.startswith('<image1> '):
        raise ValueError('The preset must reference the sketch as <image1>')
    return preset + content


def edit_size(width, height):
    """AI Toolkit's get_bucket_for_image_size at the edit resolution, so buckets keep this size."""
    max_pixels = EDIT_RESOLUTION * EDIT_RESOLUTION
    target = min(width * height, max_pixels)
    scale = (target / (width * height)) ** 0.5
    w_raw, h_raw = width * scale / EDIT_DIVISIBILITY, height * scale / EDIT_DIVISIBILITY
    candidates = [(fw(w_raw) * EDIT_DIVISIBILITY, fh(h_raw) * EDIT_DIVISIBILITY)
                  for fw in (math.floor, math.ceil) for fh in (math.floor, math.ceil)]
    capped = [(w, h) for w, h in candidates if w > 0 and h > 0 and w * h <= max_pixels]
    return min(capped, key=lambda size: abs(size[0] * size[1] - target))


def fitted_png(path, size):
    """Scale to cover and centre-crop like the toolkit does, then store losslessly."""
    with Image.open(path) as image:
        image = image.convert('RGB')
        factor = max(size[0] / image.width, size[1] / image.height)
        scaled = image.resize((math.ceil(image.width * factor), math.ceil(image.height * factor)), Image.LANCZOS)
    left, top = (scaled.width - size[0]) // 2, (scaled.height - size[1]) // 2
    buffer = BytesIO()
    scaled.crop((left, top, left + size[0], top + size[1])).save(buffer, 'PNG')
    return buffer.getvalue()


def prepare(source, destination, sketch, summarize, *, preset, model_name):
    """sketch(image_path, method) -> PNG bytes; summarize(name, chinese) -> short caption."""
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    sections = {'train': manifest['train'], 'validation': manifest['validation']}
    names = sections['train'] + sections['validation']
    if len(names) != len(set(names)) or not all(sections.values()):
        raise ValueError('Training and validation must be non-empty and disjoint')
    for section, members in sections.items():
        for name in members:
            if Path(name).name != name:
                raise ValueError('Dataset manifest contains an invalid filename')
            for filename in (name, str(Path(name).with_suffix('.txt'))):
                path = source / section / filename
                if not path.is_file() or digest(path) != manifest['sha256'][filename]:
                    raise ValueError(f'Source changed: {filename}')
    if destination.resolve() == source.resolve():
        raise ValueError('Choose a separate v3 dataset directory')
    identity = {
        'version': 3, 'source': str(source), 'seed': manifest['seed'],
        'train': sections['train'], 'validation': sections['validation'],
        'source_sha256': manifest['sha256'], 'caption_model': model_name,
        'sketch_methods': list(SKETCH_METHODS), 'preset': preset,
        'groups': ['t2i_long', 't2i_short', 'edit_manga (preset + short content)', 'edit_coarse (preset only)'],
        'edit_pairs': f'PNG target and sketch at the {EDIT_RESOLUTION}px bucket size, multiples of {EDIT_DIVISIBILITY}',
    }
    identity_path = destination / 'preparation.json'
    if destination.exists():
        if not identity_path.is_file() or json.loads(identity_path.read_text(encoding='utf-8')) != identity:
            raise ValueError('Destination belongs to another preparation; refusing to overwrite')
    else:
        destination.mkdir(parents=True)
        atomic_json(identity_path, identity)

    texts = {name: (source / section / name).with_suffix('.txt').read_text(encoding='utf-8')
             for section, members in sections.items() for name in members}
    longs = {name: long_caption(name, text) for name, text in texts.items()}

    cache_path = destination / 'short_captions.json'
    shorts = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.is_file() else {}
    for name, value in shorts.items():
        if name not in names or short_caption(value) != value:
            raise ValueError(f'Unexpected short caption cache entry: {name}')
    for name in names:
        if name in shorts:
            continue
        for attempt in range(3):
            try:
                shorts[name] = short_caption(summarize(name, split_caption(texts[name])[1]))
                break
            except Exception as error:
                print(json.dumps({'file': name, 'retry': attempt + 1, 'error': str(error)[:120]}, ensure_ascii=False), flush=True)
                if attempt == 2:
                    raise RuntimeError(f'Short caption failed for {name}') from None
                time.sleep(2 ** attempt)
        atomic_json(cache_path, shorts)
        print(json.dumps({'short_captions': len(shorts), 'total': len(names), 'file': name}), flush=True)

    sketch_root = destination / 'sketches'
    for method in SKETCH_METHODS:
        (sketch_root / method).mkdir(parents=True, exist_ok=True)
        for section, members in sections.items():
            for name in members:
                path = sketch_root / method / (Path(name).stem + '.png')
                if not path.exists():
                    write_once(path, sketch(source / section / name, method))
                    print(json.dumps({'sketch': method, 'file': name}), flush=True)

    hashes = {}

    def place(folder, filename, content=None, copy_from=None):
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / filename
        if copy_from is not None:
            if path.exists():
                if digest(path) != digest(copy_from):
                    raise ValueError(f'Existing copy changed: {path.name}')
            else:
                shutil.copy2(copy_from, path)
        else:
            write_once(path, content)
        hashes[str(path.relative_to(destination))] = digest(path)

    for name in sections['train']:
        image, stem = source / 'train' / name, Path(name).stem
        tags = split_caption(texts[name])[0]
        content = with_signature(shorts[name], tags)
        place(destination / 't2i_long', name, copy_from=image)
        place(destination / 't2i_long', stem + '.txt', longs[name] + '\n')
        place(destination / 't2i_short', name, copy_from=image)
        place(destination / 't2i_short', stem + '.txt', content + '\n')
        with Image.open(image) as original:
            size = edit_size(*original.size)
        for method, caption in (('manga', edit_caption(preset, content)), ('coarse', edit_caption(preset))):
            place(destination / f'edit_{method}', stem + '.png', fitted_png(image, size))
            place(destination / f'edit_{method}', stem + '.txt', caption + '\n')
            place(destination / f'edit_{method}_control', stem + '.png', fitted_png(sketch_root / method / (stem + '.png'), size))
    for name in sections['validation']:
        image, stem = source / 'validation' / name, Path(name).stem
        tags = split_caption(texts[name])[0]
        place(destination / 'validation', name, copy_from=image)
        place(destination / 'validation', stem + '.long.txt', longs[name] + '\n')
        place(destination / 'validation', stem + '.short.txt', with_signature(shorts[name], tags) + '\n')
        for method in SKETCH_METHODS:
            place(destination / 'validation', f'{stem}.{method}.png', copy_from=sketch_root / method / (stem + '.png'))
    # Verify the source again after the external caption and sketch calls.
    for section, members in sections.items():
        for name in members:
            for filename in (name, str(Path(name).with_suffix('.txt'))):
                if digest(source / section / filename) != manifest['sha256'][filename]:
                    raise ValueError(f'Source changed during preparation: {filename}')
    result = {**identity, 'sha256': hashes, 'complete': True, 'completed_at': datetime.now(timezone.utc).isoformat()}
    atomic_json(destination / 'manifest.json', result)
    return result


def comfyui_sketcher():
    """Line-art preprocessors already installed in ComfyUI (comfyui_controlnet_aux)."""
    from comfyui.requests.local_comfyui_request import LocalComfyUIRequest

    nodes = {'manga': ('Manga2Anime_LineArt_Preprocessor', {}), 'coarse': ('LineArtPreprocessor', {'coarse': 'enable'})}
    request = LocalComfyUIRequest()

    async def run(image_path, method):
        node, options = nodes[method]
        with Image.open(image_path) as original:
            size = original.size
        uploaded = await request._upload_overwrite_image(str(image_path), f'ameniwa_v3_{image_path.name}')
        remote = '/'.join(filter(None, (uploaded.get('subfolder'), uploaded['name'])))
        graph = {
            '1': {'class_type': 'LoadImage', 'inputs': {'image': remote}},
            '2': {'class_type': node, 'inputs': {'image': ['1', 0], 'resolution': max(512, min(1024, min(size) // 64 * 64)), **options}},
            '3': {'class_type': 'SaveImage', 'inputs': {'images': ['2', 0], 'filename_prefix': f'ameniwa_v3/{image_path.stem}_{method}'}},
        }
        prompt_id = await request._queue_and_poll(graph, timeout=600, poll_interval=1.0)
        item = request.api.get_history(prompt_id)[prompt_id]['outputs']['3']['images'][0]
        sketch = Image.open(BytesIO(request.api.get_image(item['filename'], item['subfolder'], item['type']))).convert('L')
        # ControlNet line art is white on black; a draft is dark lines on paper.
        if sum(sketch.resize((64, 64)).getdata()) / 4096 < 128:
            sketch = ImageOps.invert(sketch)
        buffer = BytesIO()
        sketch.resize(size, Image.LANCZOS).convert('RGB').save(buffer, 'PNG')
        return buffer.getvalue()

    return lambda image_path, method: asyncio.run(run(image_path, method))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Bilingual dataset with manifest.json, train/ and validation/')
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    from server.api.prompt import PROMPT_PRESETS
    from utils.config_loader import get_config
    from utils.image_mentions import resolve_image_mentions
    from utils.llm import LanguageModel

    # Train on exactly what the app sends: the preset with @图片1 resolved to <image1>.
    preset = resolve_image_mentions(next(p.prompt for p in PROMPT_PRESETS if p.id == 'sketch_finish'), ['sketch'], 'qwen')
    system = (
        '你是图像训练数据标注员。把给出的中文画面描述压缩成一句中文短描述，20到45个字。'
        '只保留人物数量、发型发色、主要服装、动作姿势和背景，像用户写给绘图工具的简短要求。'
        '不要写画风、画法、线条、上色、光影、阴影、高光、色块、构图、镜头、质量评价，也不要提签名或文字。'
        '只输出这一句中文，以句号结尾。'
    )

    def summarize(name, chinese):
        return LanguageModel().complete('画面描述：' + chinese, system=system)

    result = prepare(args.source, args.destination, comfyui_sketcher(), summarize,
                     preset=preset, model_name=get_config().codex_llm.model)
    print(json.dumps({'complete': True, 'train': len(result['train']), 'validation': len(result['validation']),
                      'files': len(result['sha256'])}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
