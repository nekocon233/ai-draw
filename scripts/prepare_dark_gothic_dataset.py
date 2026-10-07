"""Prepare and audit full-body Darkest Dungeon hero poses for a style LoRA.

Assets and pinned upstream tools live outside the repository. This module never modifies raw
assets. The renderer uses the game's old Spine format, including rotations, meshes and draw order.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import re
import shutil
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFont, ImageOps

SEED = 20261001
EXCLUDED_ACTIONS = re.compile(r'camp|walk|idle|afflict|heroic|investigat|death|dead|corpse|riposte', re.I)
# Visually reviewed against review/index.json: preserve the game's ink/shadows and proportions.
MOD_SELECTION = {
    '1404716297': None, '1707294887': None, '2891478943': None, '2951463152': None,
    '3300928065': ['H_crusader_Z'], '3302774636': None,
    '3320659589': ['Hazu_jester_B'], '3346443057': None, '3350668137': None,
    '3443082911': None, '3461436421': None, '3509124466': None,
    '3543204439': None, '3545220717': None, '3554390514': None,
    '3563817164': None, '3580425424': None, '3619645568': ['H_crusader_D'],
    '3646819625': None, '3663787885': None, '3788187129': None,
    '3808690291': None, '3809030748': ['enforcer_A'],
}
BASE_FEMALE = {'antiquarian', 'arbalest', 'grave_robber', 'hellion', 'plague_doctor', 'vestal'}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bootstrap(root):
    lock_path = Path(__file__).resolve().parents[1] / 'configs/training/dark_gothic_tools.json'
    locked = json.loads(lock_path.read_text())
    target = root / 'tools'
    target.mkdir(parents=True, exist_ok=True)
    for name, entry in locked.items():
        if Path(name).name != name:
            raise ValueError('Unsafe dependency name')
        file = target / name
        if file.exists():
            if digest(file) != entry['sha256']:
                raise ValueError('Dependency was modified: ' + name)
        else:
            with urllib.request.urlopen(entry['url'], timeout=30) as response:
                content = response.read()
            if hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise ValueError('Upstream dependency changed: ' + name)
            temporary = file.with_suffix(file.suffix + '.tmp')
            temporary.write_bytes(content)
            temporary.replace(file)
    atomic_json(target / 'dependencies.json', locked)


def make_jobs(root):
    bootstrap(root)
    sys.path.insert(0, str(root / 'tools'))
    from spBinaryReader import spBinaryReader
    from spJsonWriter import spJsonWriter
    sources = json.loads((root / 'sources.json').read_text())
    jobs, excluded = [], []
    skeleton_cache = root / 'skeletons'
    skeleton_cache.mkdir(exist_ok=True)
    for source in sources:
        for hero in sorted((root / 'raw' / source['id'] / 'heroes').iterdir()):
            if not hero.is_dir():
                continue
            skin_dirs = sorted({p.parent for p in hero.glob('*/anim/*.sprite.*.png')})
            # Render the first two palettes per pack for review; later selections share a pose quota.
            for skin_dir in skin_dirs[:2]:
                family = source['id'] + '/' + hero.name
                skin = skin_dir.parent.name
                for texture in sorted(skin_dir.glob('*.sprite.*.png')):
                    action = texture.stem.split('.sprite.', 1)[1]
                    if EXCLUDED_ACTIONS.search(action):
                        continue
                    stem = texture.stem
                    candidates = [hero / 'anim' / (stem + '.skel'),
                                  root / 'raw/base/heroes' / hero.name / 'anim' / (stem + '.skel')]
                    skel = next((p for p in candidates if p.is_file() and p.with_suffix('.atlas').is_file()), None)
                    if not skel:
                        excluded.append({'file': str(texture.relative_to(root)), 'reason': 'missing_matching_skeleton'})
                        continue
                    key = digest(skel)
                    converted = skeleton_cache / (key + '.json')
                    try:
                        if not converted.exists():
                            data = spBinaryReader().readSkeletonDataFile(str(skel))
                            spJsonWriter().writeSkeletonDataFile(data, str(converted))
                        data = json.loads(converted.read_text())
                        if data.get('skeleton', {}).get('spine') not in ('2.1.27', '2.1.25', None):
                            raise ValueError('unsupported_spine_version')
                    except Exception as error:
                        excluded.append({'file': str(texture.relative_to(root)), 'reason': 'skeleton_parse_error',
                                         'error': str(error)[:180]})
                        continue
                    identity = '|'.join([source['id'], hero.name, skin, action])
                    jobs.append({'id': hashlib.sha256(identity.encode()).hexdigest()[:16],
                                 'family': family, 'source': source['id'], 'title': source['title'],
                                 'hero': hero.name, 'skin': skin, 'action': action,
                                 'texture': str(texture.relative_to(root)),
                                 'texture_sha256': digest(texture), 'skeleton': str(converted.relative_to(root)),
                                 'original_skeleton': str(skel.relative_to(root)),
                                 'atlas': str(skel.with_suffix('.atlas').relative_to(root)),
                                 'phase': 0.25 if action == 'combat' else 0.35})
    jobs.sort(key=lambda j: (j['source'] != 'base', j['source'], j['hero'], j['skin'], j['action'] != 'combat', j['action']))
    atomic_json(root / 'jobs.json', jobs)
    atomic_json(root / 'exclusions.json', excluded)
    print(json.dumps({'jobs': len(jobs), 'families': len({j['family'] for j in jobs}), 'excluded': len(excluded)}))


def fitted_image(image, background=(255, 255, 255)):
    image = image.convert('RGBA')
    bbox = image.getchannel('A').point(lambda p: 255 if p > 12 else 0).getbbox()
    if not bbox:
        raise ValueError('empty_pose')
    image = image.crop(bbox)
    # No random crop: the whole silhouette, including held equipment, is always retained.
    scale = min(1.6, 880 / max(image.size))
    size = tuple(max(1, round(side * scale)) for side in image.size)
    image = image.resize(size, Image.Resampling.LANCZOS)
    width = math.ceil((size[0] + 128) / 64) * 64
    height = math.ceil((size[1] + 128) / 64) * 64
    canvas = Image.new('RGB', (width, height), background)
    canvas.paste(image, ((width - size[0]) // 2, (height - size[1]) // 2), image)
    return canvas


def review(root):
    jobs = json.loads((root / 'jobs.json').read_text())
    families = defaultdict(list)
    for job in jobs:
        metadata = root / 'poses' / (job['id'] + '.png.json')
        if metadata.exists() and json.loads(metadata.read_text()).get('render_version') == 2:
            families[(job['family'], job['skin'])].append(job)
    entries = []
    for (family, skin), values in sorted(families.items()):
        values.sort(key=lambda j: (j['action'] != 'combat', j['action'] != 'defend', j['action']))
        entries.append({'number': len(entries) + 1, 'family': family, 'skin': skin,
                        'title': values[0]['title'], 'samples': [j['id'] for j in values[:3]]})
    atomic_json(root / 'review/index.json', entries)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    for start in range(0, len(entries), 12):
        canvas = Image.new('RGB', (1500, 1320), '#e9e9e9')
        draw = ImageDraw.Draw(canvas)
        for offset, item in enumerate(entries[start:start + 12]):
            x, y = (offset % 3) * 500, (offset // 3) * 330
            draw.text((x + 5, y + 3), f"{item['number']} {item['family']} {item['skin']}"[:64], font=font, fill='black')
            draw.text((x + 5, y + 22), item['title'][:60], font=font, fill='black')
            for col, identity in enumerate(item['samples']):
                with Image.open(root / 'poses' / (identity + '.png')) as pose:
                    picture = fitted_image(pose)
                picture.thumbnail((162, 276))
                canvas.paste(picture, (x + col * 166 + (162 - picture.width) // 2, y + 48))
        canvas.save(root / 'review' / f'page_{start // 12 + 1:02d}.jpg', quality=92)
    print(json.dumps({'review_skins': len(entries), 'pages': math.ceil(len(entries) / 12)}))


def grouped_split(records, fraction=0.1):
    groups = defaultdict(list)
    for record in records:
        groups[record['family']].append(record)
    held = set()
    for source in ('base', 'mod'):
        names = sorted(name for name in groups if (name.startswith('base/')) == (source == 'base'))
        rng = random.Random(SEED + (source == 'mod'))
        rng.shuffle(names)
        # Keep female designs in validation too; a purely random small holdout can contain only men.
        female = [name for name in names if sum(r.get('caption', {}).get('gender') == 'female'
                                                for r in groups[name]) >= len(groups[name]) / 2]
        other = [name for name in names if name not in female]
        target = min(len(names) - 1, max(2 if female and other else 1, round(len(names) * fraction)))
        chosen = []
        for stratum in (female, other):
            if stratum and len(chosen) < target:
                chosen.append(min(stratum, key=lambda name: len(groups[name])))
        chosen.extend(name for name in names if name not in chosen)
        held.update(chosen[:max(0, target)])
    return {record['id']: 'validation' if record['family'] in held else 'train' for record in records}


def difference_hash(image):
    gray = ImageOps.grayscale(image).resize((17, 16), Image.Resampling.LANCZOS)
    pixels = gray.tobytes()
    value = 0
    for y in range(16):
        for x in range(16):
            value = (value << 1) | (pixels[y * 17 + x] > pixels[y * 17 + x + 1])
    return value


def select(root):
    groups = defaultdict(list)
    rejected = []
    for job in json.loads((root / 'jobs.json').read_text()):
        is_base = job['source'] == 'base'
        if job['hero'] == 'abomination' or (not is_base and job['source'] not in MOD_SELECTION):
            continue
        skins = MOD_SELECTION.get(job['source'])
        if skins and job['skin'] not in skins:
            continue
        pose = root / 'poses' / (job['id'] + '.png')
        metadata = pose.with_suffix('.png.json')
        if not metadata.exists() or json.loads(metadata.read_text()).get('render_version') != 2:
            continue
        with Image.open(pose) as image:
            image = image.convert('RGBA')
            histogram = image.getchannel('A').histogram()
            nonzero = sum(histogram[13:])
            if not nonzero or sum(histogram[13:225]) / nonzero > 0.18:
                rejected.append({'id': job['id'], 'reason': 'translucent_pose_or_effects'})
                continue
            fitted = fitted_image(image)
        groups[job['family']].append((job, fitted, difference_hash(fitted)))
    records = []
    target = root / 'candidates'
    target.mkdir(exist_ok=True)
    for family, candidates in sorted(groups.items()):
        candidates.sort(key=lambda item: (item[0]['action'] != 'combat', item[0]['action'] != 'defend',
                                          item[0]['skin'], item[0]['action']))
        picked = []
        actions = set()
        while candidates and len(picked) < 5:
            if len(picked) < 2:
                index = 0
            else:
                distances = [min((item[2] ^ previous[2]).bit_count() for previous in picked)
                             if item[0]['action'] not in actions else -1 for item in candidates]
                index = max(range(len(candidates)), key=lambda i: distances[i])
                if distances[index] < 8:
                    break
            item = candidates.pop(index)
            if item[0]['action'] in actions:
                continue
            picked.append(item)
            actions.add(item[0]['action'])
        for job, fitted, dhash in picked:
            # Background is independent of source/style, deterministic, and named in the caption.
            grey = int(job['id'], 16) % 4 == 0
            if grey:
                with Image.open(root / 'poses' / (job['id'] + '.png')) as image:
                    fitted = fitted_image(image, (238, 238, 238))
            output = target / (job['id'] + '.png')
            fitted.save(output)
            records.append({**job, 'image_sha256': digest(output), 'dhash': hex(dhash),
                            'background': 'light grey' if grey else 'white',
                            'split_group': family, 'selection_version': 1})
    # Known derivative packs must remain in the same split as their original design.
    for record in records:
        if record['source'] in ('3300928065', '3619645568', '3808690291'):
            record['family'] = 'hazu/crusader'
    atomic_json(root / 'selection.json', records)
    atomic_json(root / 'selection_rejections.json', rejected)
    print(json.dumps({'selected': len(records), 'sources': dict(Counter('base' if r['source']=='base' else 'mod' for r in records)),
                      'families': len({r['family'] for r in records}), 'rejected_translucent': len(rejected)}))


def finalize(root):
    from caption_dark_gothic_dataset import validate
    selected = json.loads((root / 'selection.json').read_text())
    overrides_path = root / 'review/overrides.json'
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    accepted, rejected = [], []
    for record in selected:
        image = root / 'candidates' / (record['id'] + '.png')
        if digest(image) != record['image_sha256']:
            raise ValueError('Candidate changed: ' + record['id'])
        saved = json.loads((root / 'captions' / (record['id'] + '.json')).read_text())
        if saved['image_sha256'] != record['image_sha256']:
            raise ValueError('Caption belongs to another image')
        caption = validate(saved['caption'])
        override = overrides.get(record['id'], {})
        keep = override.get('keep', caption['keep'])
        if override and (override.get('image_sha256') != record['image_sha256'] or not override.get('reason')):
            raise ValueError('Invalid visual-review override')
        if not keep:
            rejected.append({**record, 'reason': override.get('reason', caption['reason'])})
            continue
        accepted.append({**record, 'caption': caption, 'manual_review': override})
    split = grouped_split(accepted)
    if len({r['family'] for r in accepted}) < 10:
        raise ValueError('Too few independent designs')
    output_records = []
    for record in accepted:
        section = split[record['id']]
        folder = root / ('validation' if section == 'validation' else 'train')
        folder.mkdir(exist_ok=True)
        image = folder / (record['id'] + '.png')
        caption_path = image.with_suffix('.txt')
        text = record['caption']['english'].strip() + '\n\n' + record['caption']['chinese'].strip() + '\n'
        if image.exists() and digest(image) != record['image_sha256']:
            raise ValueError('Existing training image changed')
        if caption_path.exists() and caption_path.read_text() != text:
            raise ValueError('Existing training caption changed')
        if not image.exists():
            shutil.copy2(root / 'candidates' / image.name, image)
        if not caption_path.exists():
            caption_path.write_text(text, encoding='utf-8')
        group = 'mod' if record['source'] != 'base' else ('base_female' if record['caption']['gender'] == 'female' else 'base_other')
        if section == 'train':
            grouped = root / 'train_groups' / group
            grouped.mkdir(parents=True, exist_ok=True)
            for source_path in (image, caption_path):
                dest = grouped / source_path.name
                if dest.exists() and digest(dest) != digest(source_path):
                    raise ValueError('Grouped training copy changed')
                if not dest.exists():
                    shutil.copy2(source_path, dest)
        output_records.append({**record, 'split': section, 'training_group': group, 'caption_sha256': digest(caption_path)})
    # Refuse stale files from a different selection instead of silently mixing runs.
    for section in ('train', 'validation'):
        wanted = {r['id'] for r in output_records if r['split'] == section}
        found = {p.stem for p in (root / section).glob('*.png')}
        if wanted != found:
            raise ValueError('Output folder contains stale samples')
    summary = {}
    for section in ('train', 'validation'):
        rows = [r for r in output_records if r['split'] == section]
        summary[section] = {'images': len(rows), 'families': len({r['family'] for r in rows}),
                            'sources': dict(Counter('base' if r['source'] == 'base' else 'mod' for r in rows)),
                            'gender': dict(Counter(r['caption']['gender'] for r in rows))}
    training = [r for r in output_records if r['split'] == 'train']
    best = None
    for mod in range(1, 13):
        for female in range(1, 13):
            for other in range(1, 13):
                repeats = {'mod': mod, 'base_female': female, 'base_other': other}
                total = sum(repeats[r['training_group']] for r in training)
                mod_ratio = sum(repeats[r['training_group']] for r in training if r['source'] != 'base') / total
                female_ratio = sum(repeats[r['training_group']] for r in training if r['caption']['gender'] == 'female') / total
                score = abs(mod_ratio - .6) + abs(female_ratio - .75) + max(repeats.values()) * .001
                candidate = (score, total, repeats, mod_ratio, female_ratio)
                if best is None or candidate[:2] < best[:2]:
                    best = candidate
    sampling = {'repeats': best[2], 'effective_images': best[1], 'mod_ratio': best[3], 'female_ratio': best[4]}
    atomic_json(root / 'manifest.json', {'version': 2, 'seed': SEED, 'complete': True,
                                        'summary': summary, 'sampling': sampling, 'records': output_records, 'rejected': rejected})
    print(json.dumps(summary))
    print(json.dumps(sampling))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['bootstrap', 'jobs', 'review', 'select', 'finalize'])
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    {'bootstrap': bootstrap, 'jobs': make_jobs, 'review': review, 'select': select, 'finalize': finalize}[args.command](args.root)
