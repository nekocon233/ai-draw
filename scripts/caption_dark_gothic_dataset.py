"""Content-only bilingual captions and visual QA, cached against exact candidate bytes."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
FORBIDDEN = re.compile(r'二次元|动漫|画风|风格|平涂|厚涂|赛璐璐|水彩|写实|粗黑|块面|轮廓线|描边|高对比|暗黑地牢|克苏鲁|Q版|黑色阴影|哥特|插画|线条|笔触|渲染|上色|光影|阴影|暗部|亮部|高光|anime|cartoon|chibi|gothic|darkest.dungeon|cel.shad|illustrat|render|outlin|linework|flat.colou?r|high.contrast|comic|painterly|sprite|video.game', re.I)
SYSTEM = '''你负责为角色图片制作训练标注并检查素材是否完整。仅输出 JSON 对象：
{"english":"英文内容描述，30至65个单词", "chinese":"中文内容描述，60至140字", "gender":"female/male/unknown", "keep":true, "reason":"ok 或具体排除原因"}。
只描述实际可见的角色数量、性别外观、头发、帽子面具、衣服颜色与种类、武器或道具、动作姿势、身体朝向、全身构图和背景。图中面部遮住时如实描述，不猜测眼睛或身份。裙摆或长袍遮住脚不等于被裁切。
绝对不要写画风、画法、上色、线条粗细、光影阴影、黑色块、渲染技术、画师、作品名或游戏名；不要写动漫、二次元、哥特、克苏鲁、Q版、插画、像素、精灵图等标签。不要抄写画面文字。英文也遵守同样规则。
这是素材质量检查。只有存在身体拼装错误、身体部件意外断开、切掉头部或肢体、主体仅为剪影/透明残影、画面主体为非人形怪物、明显裸露乳头或生殖器时才 keep=false，并注明原因；普通露肩、露腰、低领或轻甲不作为拒收原因。服饰遮挡、自然遮挡和侧身姿势不算缺失。
背景是纯白或浅灰，请据实描述。不要对图中人物猜测年龄，不写性感、诱惑等评价。'''


def validate(value):
    if not isinstance(value, dict) or not isinstance(value.get('keep'), bool):
        raise ValueError('Expected QA JSON')
    for language in ('english', 'chinese'):
        text = value.get(language, '').strip()
        if not text or len(text) > 1000 or FORBIDDEN.search(text):
            raise ValueError('Caption contains rendering terms or invalid text')
    if value.get('gender') not in ('female', 'male', 'unknown'):
        raise ValueError('Invalid gender category')
    if len(re.findall(r'[\u3400-\u9fff]', value['chinese'])) < 15:
        raise ValueError('Missing Chinese caption')
    return value


def prepare(root, workers=3):
    from utils.llm import LanguageModel
    records = json.loads((root / 'selection.json').read_text())
    cache = root / 'captions'
    cache.mkdir(exist_ok=True)
    def generate(record):
        identity = record['id']
        path = root / 'candidates' / (identity + '.png')
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != record['image_sha256']:
            raise ValueError('Candidate changed')
        destination = cache / (identity + '.json')
        if destination.exists():
            saved = json.loads(destination.read_text())
            if saved['image_sha256'] != sha:
                raise ValueError('Cached caption image changed')
            validate(saved['caption'])
            return identity, saved['caption']['keep'], True
        encoded = base64.b64encode(path.read_bytes()).decode()
        client = LanguageModel()
        for attempt in range(4):
            try:
                answer = client.complete('请检查图片并按要求输出双语内容标注 JSON。', system=SYSTEM, images=[encoded])
                text = answer.strip()
                if text.startswith('```'):
                    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
                caption = validate(json.loads(text))
                saved = {'id': identity, 'image_sha256': sha, 'caption_model': client.model,
                         'policy': 'dark-gothic-content-only-v1', 'caption': caption}
                temporary = destination.with_suffix('.tmp')
                temporary.write_text(json.dumps(saved, ensure_ascii=False, indent=2)+'\n')
                temporary.replace(destination)
                return identity, caption['keep'], False
            except Exception as error:
                print(json.dumps({'id': identity, 'attempt': attempt + 1, 'error_type': type(error).__name__}), flush=True)
                if attempt == 3:
                    raise RuntimeError('Caption failed: ' + identity) from None
                time.sleep(2 ** attempt)
    failures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(generate, record): record['id'] for record in records}
        for count, future in enumerate(as_completed(futures), 1):
            try:
                identity, keep, cached = future.result()
                print(json.dumps({'done': count, 'total': len(records), 'id': identity, 'keep': keep, 'cached': cached}), flush=True)
            except Exception as error:
                failures.append(futures[future])
                print(json.dumps({'failed': futures[future], 'error_type': type(error).__name__}), flush=True)
    if failures:
        raise RuntimeError(f'{len(failures)} captions failed; rerun to retry only unfinished images')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--workers', type=int, default=3, choices=(1,2,3))
    args = parser.parse_args()
    prepare(args.root, args.workers)
