"""Run the reviewed AI Toolkit job and restore drawing after success or failure.

Credentials stay inside their existing containers. No active generation/training is interrupted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import yaml

ROOT = Path('/opt/ai-toolkit/datasets/dark_gothic_anime_v1')
STATE = ROOT / 'training-state.json'
CONFIG = Path(__file__).resolve().parents[1] / 'configs/training/dark_gothic_anime_qwen_image_21.yaml'
JOB_NAME = 'DarkGothicAnimeQwen21'
OUTPUT = Path('/opt/ai-toolkit/output') / JOB_NAME
WATCH_UNIT = 'aidraw-dark-gothic-watch'


def run(args, code=None, timeout=90):
    result = subprocess.run(args, input=code, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        # External responses may contain credentials. Never propagate them to logs.
        raise RuntimeError('Command failed: ' + ' '.join(args[:3]))
    return result.stdout.strip()


def record(state):
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(STATE)


def inside(container, code):
    return run(['docker', 'exec', '-i', container, 'python3', '-B', '-'], code=code)


def service(action):
    code = '''
import json,secrets,urllib.request
from utils.config_loader import get_config
from server.database import SessionLocal
from server.models import User
cfg=get_config()
base='http://127.0.0.1:'+str(cfg.server.port)
action=ACTION
username='dark_gothic_'+secrets.token_hex(6)
token=None
def request(path,payload=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(base+path,data=data,headers=headers)
    return json.load(urllib.request.urlopen(req,timeout=30))
try:
    if action=='status': print(json.dumps(request('/api/service/status')))
    else:
        token=request('/api/auth/register',{'username':username,'password':secrets.token_urlsafe(32),'invite_code':cfg.auth.invite_code})['access_token']
        print(json.dumps(request('/api/service/'+action,{})))
finally:
    if action!='status':
        with SessionLocal() as db:
            user=db.query(User).filter(User.username==username).first()
            if user: db.delete(user); db.commit()
'''.replace('ACTION', repr(action))
    return json.loads(inside('ai-draw-backend', code))


def toolkit(path, payload=None):
    code = '''
import json,os,urllib.request
payload=PAYLOAD
data=json.dumps(payload).encode() if payload is not None else None
req=urllib.request.Request('http://127.0.0.1:8675'+PATH,data=data,headers={'Authorization':'Bearer '+os.environ['AI_TOOLKIT_AUTH'],'Content-Type':'application/json'})
value=json.load(urllib.request.urlopen(req,timeout=45))
print(json.dumps(value))
'''.replace('PAYLOAD', repr(payload)).replace('PATH', repr(path))
    return json.loads(inside('ai-toolkit', code))


def status(job_id):
    code = '''
import json,sqlite3
c=sqlite3.connect('file:/app/ai-toolkit/aitk_db.db?mode=ro',uri=True,timeout=15)
c.row_factory=sqlite3.Row
row=c.execute('SELECT id,name,status,step,info,pid FROM Job WHERE id=?',(JOB,)).fetchone()
active=c.execute("SELECT count(*) FROM Job WHERE status IN ('running','queued','stopping')").fetchone()[0]
print(json.dumps({'job':dict(row),'active_jobs':active}))
'''.replace('JOB', repr(job_id))
    return json.loads(inside('ai-toolkit', code))


def comfy_queue():
    return json.loads(inside('comfyui', "import json,urllib.request; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:8188/queue',timeout=15))))"))


def restore(state):
    if state.get('comfy_was_running'):
        run(['docker', 'start', 'comfyui'])
        for _ in range(30):
            try:
                inside('comfyui', "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8188/system_stats',timeout=10).read()")
                break
            except Exception:
                time.sleep(5)
        else:
            raise RuntimeError('ComfyUI did not become ready')
    if state.get('service_was_available'):
        service('start')
    state['service_restored'] = True
    record(state)


def launch_watcher(state):
    # A systemd-owned cgroup survives cancellation of the shell/assistant session.
    state.pop('watcher_pid', None)
    state['watcher_unit'] = WATCH_UNIT + '.service'
    record(state)
    run(['systemd-run', '--unit=' + WATCH_UNIT, '--collect',
         '--property=Restart=on-failure', '--property=RestartSec=15',
         '--property=WorkingDirectory=' + str(Path(__file__).resolve().parents[1]),
         '--property=StandardOutput=append:' + str(ROOT / 'training-watch.log'),
         '--property=StandardError=append:' + str(ROOT / 'training-watch.log'),
         sys.executable, '-u', str(Path(__file__).resolve()), 'watch'])


def verify_resume(job, config):
    pause = json.loads((ROOT / 'pause.json').read_text())
    if job['id'] != pause['job_id'] or job['status'] != 'stopped' or job['step'] != pause['resume_step']:
        raise ValueError('The paused job no longer matches its recovery record')
    saved_config = json.loads(job['job_config']) if isinstance(job['job_config'], str) else job['job_config']
    if saved_config != config:
        raise ValueError('The training configuration changed while paused')
    if job['step'] >= config['config']['process'][0]['train']['steps']:
        raise ValueError('The training target has already been reached')
    for name in (f'{JOB_NAME}_{job["step"]:09d}.safetensors', 'optimizer.pt'):
        digest = hashlib.sha256()
        with (OUTPUT / name).open('rb') as stream:
            for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != pause['sha256'].get(name):
            raise ValueError('Paused checkpoint or optimizer changed: ' + name)
    return pause['resume_step']


def start(resume=False):
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    if not manifest['complete'] or manifest['summary']['train']['images'] < 100:
        raise ValueError('A finalized, reviewed dataset is required')
    old = json.loads(STATE.read_text()) if STATE.exists() else {}
    if old.get('training_started'):
        current = status(old['job_id'])
        if not resume or current['job']['status'] in ('running', 'queued', 'stopping'):
            print(json.dumps(current))
            return
    run(['docker', 'exec', 'ai-toolkit', 'nvidia-smi'])
    jobs = toolkit('/api/jobs')['jobs']
    if any(j['status'] in ('running', 'queued', 'stopping') for j in jobs):
        raise RuntimeError('Other training is active')
    existing = next((j for j in jobs if j['name'] == JOB_NAME), None)
    if existing and not resume:
        raise RuntimeError('Job already exists; inspect it before resuming')
    config = yaml.safe_load(CONFIG.read_text())
    if resume:
        if not existing or existing['id'] != old.get('job_id'):
            raise ValueError('No matching paused job to resume')
        resume_step = verify_resume(existing, config)
    for dataset in config['config']['process'][0]['datasets']:
        group = Path(dataset['folder_path']).name
        if dataset['num_repeats'] != manifest['sampling']['repeats'][group]:
            raise ValueError('Training sampling no longer matches the manifest')
        expected = {item['id'] for item in manifest['records']
                    if item['split'] == 'train' and item['training_group'] == group}
        for suffix in ('.png', '.txt'):
            actual = {file.stem for file in (ROOT / 'train_groups' / group).glob('*' + suffix)}
            if actual != expected:
                raise ValueError('Training folder contains missing or unrecorded samples')
    for item in manifest['records']:
        if item['split'] != 'train':
            continue
        folder = ROOT / 'train_groups' / item['training_group']
        for suffix, field in (('.png', 'image_sha256'), ('.txt', 'caption_sha256')):
            if hashlib.sha256((folder / (item['id'] + suffix)).read_bytes()).hexdigest() != item[field]:
                raise ValueError('Frozen training data changed')
    state = {'job_name': JOB_NAME, 'service_was_available': service('status')['available'],
             'comfy_was_running': run(['docker', 'inspect', '-f', '{{.State.Running}}', 'comfyui']) == 'true',
             'training_started': False, 'service_restored': False}
    if resume:
        state.update(job_id=existing['id'], resumed_from=resume_step,
                     resumed_at=datetime.now(timezone.utc).isoformat())
    record(state)
    quiet_since = None
    deadline = time.monotonic() + 3600
    while time.monotonic() < deadline:
        queue = comfy_queue()
        if not queue.get('queue_running') and not queue.get('queue_pending'):
            quiet_since = quiet_since or time.monotonic()
            if time.monotonic() - quiet_since >= 60:
                break
        else:
            quiet_since = None
        time.sleep(10)
    else:
        raise RuntimeError('Timed out waiting for generation to finish')
    try:
        service('stop')  # TaskManager's HTTP boundary rejects this with 409 if generation started.
        queue = comfy_queue()
        if queue.get('queue_running') or queue.get('queue_pending'):
            raise RuntimeError('ComfyUI became busy; generation preserved')
        run(['docker', 'stop', 'comfyui'])
        job = existing if resume else toolkit('/api/jobs', {'name': JOB_NAME, 'gpu_ids': '0', 'job_config': config})
        state['job_id'] = job['id']
        record(state)
        toolkit('/api/jobs/' + job['id'] + '/start')
        toolkit('/api/queue/0/start')
        state['training_started'] = True
        record(state)
        launch_watcher(state)
        print(json.dumps({'job_id': job['id'], 'watcher_unit': state['watcher_unit'], 'queued': True,
                          'resumed_from': state.get('resumed_from')}), flush=True)
    except Exception:
        # Never restart ComfyUI on top of a job that has already begun running.
        current = status(state['job_id']) if state.get('job_id') else {'active_jobs': 0}
        if not current['active_jobs']:
            restore(state)
        raise


def watch():
    state = json.loads(STATE.read_text())
    last = None
    while not state.get('service_restored'):
        try:
            current = status(state['job_id'])
            state.update(current)
            record(state)
            marker = (current['job']['status'], current['job']['step'] // 100)
            if marker != last:
                print(json.dumps(current, ensure_ascii=False), flush=True)
                last = marker
            if current['job']['status'] in ('completed', 'stopped', 'error', 'failed', 'cancelled') and not current['active_jobs']:
                # Query the host: the toolkit container may lose NVML even after the task has exited.
                gpu = run(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader,nounits'])
                if not gpu.strip():
                    restore(state)
                    print(json.dumps({'service_restored': True, 'status': current['job']['status']}), flush=True)
                    return
        except Exception as error:
            print(json.dumps({'retry': True, 'error_type': type(error).__name__}), flush=True)
        time.sleep(30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('start', 'resume', 'watch', 'status'))
    args = parser.parse_args()
    if args.command == 'status':
        state = json.loads(STATE.read_text())
        print(json.dumps(status(state['job_id']), ensure_ascii=False))
    else:
        {'start': start, 'resume': lambda: start(resume=True), 'watch': watch}[args.command]()
