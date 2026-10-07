"""Resumable held-out, multi-seed comparison through the production Qwen ComfyUI graph."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = [
    '银色长发的女海盗，戴黑色三角帽，右手持短弯刀，左手拿金色酒杯，完整全身，白色背景。',
    '绿色短发的女性机械师，穿橙色连体工装，双手抱着一把大型扳手，完整全身，浅灰色背景。',
    '金色双马尾的女法师，穿黑色长袍，双手捧着一块红色水晶，正面站立，完整全身，白色背景。',
    '紫色长发的女性弩手，穿棕色皮甲，双手持弩，向左跨出一步，完整全身，白色背景。',
    '黑色齐肩发的女学生，穿蓝白水手服，背着书包，双手握一把木剑，完整全身，浅灰色背景。',
    '白色双辫的修女，穿红色长裙、戴黑色头巾，双手举着烛台，侧身站立，完整全身，白色背景。',
    '棕色短发的男性厨师，穿深绿色长袖衣和白色围裙，一手持平底锅，另一手拿菜刀，完整全身，白色背景。',
    '一名肌肉结实、剃光头的深肤色男性佣兵，穿灰色铠甲，双手握住铁锤，完整全身，浅灰色背景。',
]
SEEDS = [731946, 5820193, 20261001]


def request(host, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(host.rstrip('/') + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def evaluate(host, loras, output, strength=.8):
    template_path = ROOT / 'configs/workflows/qwen_image_21_t2i_workflow_api.json'
    template = json.loads(template_path.read_text())
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'results.json'
    identity = {'prompts': PROMPTS, 'seeds': SEEDS, 'loras': loras, 'strength': strength,
                'workflow_sha256': hashlib.sha256(template_path.read_bytes()).hexdigest()}
    saved = json.loads(manifest_path.read_text()) if manifest_path.exists() else {**identity, 'results': []}
    if any(saved.get(key) != value for key, value in identity.items()):
        raise ValueError('Evaluation destination belongs to another configuration')
    results = saved['results']
    existing = {result['file']: result for result in results}
    run = 'dark_gothic_eval_' + uuid.uuid4().hex[:10]
    for index, prompt in enumerate(PROMPTS):
        for seed in SEEDS:
            for lora in loras:
                if Path(lora).name != lora or not lora.endswith('.safetensors'):
                    raise ValueError('Expected an installed LoRA filename')
                name = f'{Path(lora).stem}_p{index}_s{seed}.png'
                target = output / name
                if name in existing:
                    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != existing[name]['sha256']:
                        raise ValueError('Saved evaluation image changed')
                    continue
                if target.exists():
                    raise ValueError('Unrecorded evaluation output; inspect before retrying')
                graph = copy.deepcopy(template)
                graph['100']['inputs'].update(lora_name=lora, strength_model=strength)
                graph['4']['inputs']['prompt'] = prompt
                graph['6']['inputs']['seed'] = seed
                graph['8']['inputs']['filename_prefix'] = f'{run}/{Path(name).stem}'
                started = time.monotonic()
                # Keep at most one evaluation item queued; other clients retain normal queue access.
                while True:
                    queue = request(host, '/queue')
                    if not queue.get('queue_running') and not queue.get('queue_pending'):
                        break
                    time.sleep(5)
                prompt_id = request(host, '/prompt', {'prompt': graph, 'client_id': run})['prompt_id']
                deadline = time.monotonic() + 1200
                while time.monotonic() < deadline:
                    history = request(host, '/history/' + prompt_id).get(prompt_id, {})
                    if history.get('status', {}).get('status_str') == 'error':
                        raise RuntimeError('ComfyUI evaluation failed: ' + prompt_id)
                    images = history.get('outputs', {}).get('8', {}).get('images', [])
                    if images:
                        break
                    time.sleep(2)
                else:
                    raise TimeoutError('Evaluation timed out: ' + prompt_id)
                info = images[0]
                query = urllib.parse.urlencode({key: info[key] for key in ('filename', 'subfolder', 'type')})
                with urllib.request.urlopen(host.rstrip('/') + '/view?' + query, timeout=60) as response:
                    content = response.read()
                temporary = target.with_suffix('.tmp')
                temporary.write_bytes(content)
                temporary.replace(target)
                result = {'file': name, 'lora': lora, 'prompt': prompt, 'prompt_index': index, 'seed': seed,
                          'prompt_id': prompt_id, 'sha256': hashlib.sha256(content).hexdigest(),
                          'seconds': round(time.monotonic() - started, 2)}
                results.append(result)
                temporary = manifest_path.with_suffix('.tmp')
                temporary.write_text(json.dumps({**identity, 'results': results}, ensure_ascii=False, indent=2) + '\n')
                temporary.replace(manifest_path)
                print(json.dumps({'completed': len(results), 'total': len(loras) * len(PROMPTS) * len(SEEDS), **result}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--lora', action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--strength', type=float, default=.8)
    args = parser.parse_args()
    evaluate(args.host, args.lora, args.output, args.strength)
