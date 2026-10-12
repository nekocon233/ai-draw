"""aidraw: drive the local ai-draw from the command line. JSON goes to stdout, progress to stderr.

Exit codes: 0 ok, 1 usage, 2 timeout (resume with the printed command), 3 API error, 4 cancelled,
5 lost (backend restarted), 6 auth, 7 generation slot busy too long.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from . import jobs
from .client import Client
from .config import (
    cache_dir, clear_credentials, config_dir, load_config, load_credentials, load_token, save_credentials, session_link,
)
from .errors import ApiError, CliError, EXIT_API, EXIT_AUTH, EXIT_OK
from .gates import run_gate_cancel, run_gate_get, run_gate_list, run_gate_open, run_gate_submit, run_gate_wait
from .generate import default_out, log, run_gen, run_post, run_round_get, run_wait, upload_file
from .media import flatten, png_data_url, url_extension

BACKGROUND_MODES = ("birefnet", "inspyrenet", "ai", "edge", "none")
UPSCALE_METHODS = ("lanczos", "apisr", "real_cugan", "realesrgan_general", "realesrgan_anime", "invsr")


def emit(payload) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- auth & status

def _token_command(config: dict, *arguments: str, container=None) -> dict | list:
    command = ["docker", "exec", "-i", container or config["container"],
               "python", "-B", "-m", "server.agent_bridge.tokens", *arguments]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CliError(f"无法在容器里执行令牌命令：{error}", EXIT_AUTH) from error
    if result.returncode != 0:
        raise CliError(f"令牌命令失败：{(result.stderr or result.stdout).strip()[-500:]}", EXIT_AUTH)
    lines = [line for line in result.stdout.strip().splitlines() if line.strip()]
    try:
        return json.loads(lines[-1])
    except (IndexError, ValueError) as error:
        raise CliError("令牌命令没有返回 JSON", EXIT_AUTH) from error


def run_auth_setup(args, config, client):
    created = _token_command(config, "create", "--user", args.user, "--name", args.name, "--days", str(args.days),
                             container=args.container)
    save_credentials({
        "token": created["token"], "user": created["user"], "token_id": created["id"], "prefix": created["prefix"],
        "name": created["name"], "expires_at": created["expires_at"], "api_url": config["api_url"],
    })
    me = Client(config, created["token"]).json("GET", "/api/agent/me")
    return {"ok": True, "user": me["username"], "prefix": created["prefix"], "expires_at": created["expires_at"],
            "credentials": str(config_dir() / "credentials.json")}, EXIT_OK


def run_auth_status(args, config, client):
    credentials = load_credentials()
    me = client.json("GET", "/api/agent/me")
    return {"ok": True, "user": me["username"], "prefix": credentials.get("prefix"),
            "expires_at": credentials.get("expires_at"), "api_url": config["api_url"]}, EXIT_OK


def run_auth_users(args, config, client):
    return {"ok": True, "users": _token_command(config, "users", container=args.container)}, EXIT_OK


def run_auth_revoke(args, config, client):
    prefix = load_credentials().get("prefix")
    if not prefix:
        raise CliError("本机没有保存的令牌", EXIT_AUTH)
    revoked = _token_command(config, "revoke", "--prefix", prefix, container=args.container)
    clear_credentials()
    return {"ok": True, "revoked": revoked}, EXIT_OK


def run_doctor(args, config, client):
    checks = []

    def check(name, action, required=True):
        try:
            checks.append({"name": name, "ok": True, "detail": action()})
        except Exception as error:  # every failure is reported, none aborts the others
            checks.append({"name": name, "ok": False, "required": required, "detail": str(error)})

    check("config", lambda: {"api_url": config["api_url"], "public_url": config["public_url"], "dir": str(config_dir())})
    check("health", lambda: client.json("GET", "/health", auth=False))
    check("token", lambda: client.json("GET", "/api/agent/me")["username"])

    def service():
        status = client.json("GET", "/api/service/status", auth=False)
        if isinstance(status, dict) and status.get("available") is False:
            raise CliError(f"生成服务不可用（ComfyUI 可能停了，例如在训练 LoRA）：{status}")
        return status

    check("service", service)
    check("slot", lambda: client.json("GET", "/api/agent/slot"))
    check("workflows", lambda: [item["key"] for item in client.json("GET", "/api/service/workflows", auth=False)["workflows"]])
    check("loras", lambda: [item["label"] for item in client.json(
        "GET", "/api/service/loras", params={"workflow": "qwen_image_21_t2i"})["models"]], required=False)

    def writable():
        directory = cache_dir()
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".probe"
        probe.write_text("ok")
        probe.unlink()
        return str(directory)

    check("cache", writable)
    ok = all(item["ok"] or not item.get("required", True) for item in checks)
    return {"ok": ok, "checks": checks}, EXIT_OK if ok else EXIT_API


# ---------------------------------------------------------------- catalog

def run_workflows(args, config, client):
    workflows = client.json("GET", "/api/service/workflows", auth=False)["workflows"]
    return {"ok": True, "workflows": [{
        "id": item["key"], "label": item["label"], "output": item["output_type"], "max_count": item["max_count"],
        "max_reference_images": item.get("max_reference_images"),
        "options": [parameter["name"] for parameter in item.get("parameters", [])
                    if parameter["name"] not in ("prompt", "lora_prompt", "count", "width", "height")],
    } for item in workflows]}, EXIT_OK


def run_loras(args, config, client):
    return {"ok": True, **client.json("GET", "/api/service/loras", params={"workflow": args.workflow})}, EXIT_OK


def run_presets(args, config, client):
    presets = client.json("GET", "/api/prompt/presets").get("presets", [])
    if args.workflow:
        presets = [item for item in presets if not item.get("workflow_ids") or args.workflow in item["workflow_ids"]]
    return {"ok": True, "presets": [{
        "id": item["id"], "title": item["title"], "output": item.get("output_type"),
        "workflows": item.get("workflow_ids"), "description": item.get("description"),
    } for item in presets]}, EXIT_OK


# ---------------------------------------------------------------- sessions & media

def run_session_new(args, config, client):
    session = client.json("POST", "/api/agent/sessions", json={"title": args.title})
    return {"ok": True, **session, "link": session_link(config, session["session_id"])}, EXIT_OK


def run_session_list(args, config, client):
    sessions = client.json("GET", "/api/chat/sessions")[: args.limit]
    return {"ok": True, "sessions": [{
        "id": item["id"], "title": item["title"], "updated_at": item["updated_at"],
        "messages": item.get("message_count"), "link": session_link(config, item["id"]),
    } for item in sessions]}, EXIT_OK


def run_session_link(args, config, client):
    return {"ok": True, "link": session_link(config, args.session_id)}, EXIT_OK


def run_upload(args, config, client):
    results = []
    for file in args.files:
        path = Path(file).expanduser()
        source = flatten(path, args.flatten, cache_dir() / "flattened") if args.flatten else path
        uploaded = upload_file(client, source)
        results.append({"file": str(path), **uploaded})
    return {"ok": True, "uploads": results}, EXIT_OK


def _source_url(client: Client, source: str) -> str:
    return source if source.startswith("/uploads/") else upload_file(client, Path(source).expanduser())["url"]


def _output_path(args, url: str, label: str) -> Path:
    directory = Path(args.out).expanduser() if args.out else default_out("media")
    return directory / f"{Path(args.source).stem}.{label}.{url_extension(url)}"


def run_rmbg(args, config, client):
    body = {"image_url": _source_url(client, args.source), "background_mode": args.mode}
    if args.model:
        body["birefnet_model" if args.mode == "birefnet" else "rembg_model"] = args.model
    for item in args.option or []:
        key, _, value = item.partition("=")
        try:
            body[key] = json.loads(value)
        except ValueError:
            body[key] = value
    result = client.json("POST", "/api/media/remove-background", json=body, timeout=900)
    target = client.download(result["image_url"], _output_path(args, result["image_url"], f"rmbg-{args.mode}"))
    return {"ok": True, "url": result["image_url"], "file": str(target), "mode": result.get("background_mode")}, EXIT_OK


def run_upscale(args, config, client):
    source = Path(args.source).expanduser()
    if args.source.startswith("/uploads/"):
        source = client.download(args.source, cache_dir() / "downloads" / Path(args.source).name)
    body = {"image": png_data_url(source), "method": args.method, "scale": args.scale}
    deadline = time.monotonic() + args.timeout
    while True:
        try:
            result = client.json("POST", "/api/media/image-upscale", json=body, timeout=900)
            break
        except ApiError as error:
            if error.status != 429 or time.monotonic() > deadline:
                raise
            log("已有放大任务在处理，稍后重试…", args.quiet)
            time.sleep(10)
    # Upscale previews are deleted after a day; keep the local copy.
    target = client.download(result["image_url"], _output_path(args, result["image_url"], f"x{args.scale}-{args.method}"))
    return {"ok": True, "url": result["image_url"], "file": str(target), "width": result.get("width"),
            "height": result.get("height")}, EXIT_OK


def run_slot(args, config, client):
    return {"ok": True, **client.json("GET", "/api/agent/slot")}, EXIT_OK


def run_stop(args, config, client):
    params = {"task_id": args.task} if args.task else None
    return {"ok": True, **client.json("POST", "/api/media/stop", params=params)}, EXIT_OK


def run_job_show(args, config, client):
    return {"ok": True, "records": jobs.read(args.file)}, EXIT_OK


# ---------------------------------------------------------------- parser

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aidraw", description="让 agent 调用本机 ai-draw：生图、发结果、开审核关卡。")
    parser.add_argument("--quiet", action="store_true", help="不在 stderr 输出进度")
    commands = parser.add_subparsers(dest="command", required=True)

    def add(subparsers, name, handler, help_text):
        sub = subparsers.add_parser(name, help=help_text, description=help_text)
        sub.set_defaults(handler=handler)
        return sub

    def job_options(sub):
        sub.add_argument("--job", help="把记录追加到这个 JSONL 任务日志")
        sub.add_argument("--step", help="任务日志里的步骤名")

    auth = commands.add_parser("auth", help="访问令牌").add_subparsers(dest="action", required=True)
    setup = add(auth, "setup", run_auth_setup, "在后端容器里为账号生成令牌并保存到本机")
    setup.add_argument("--user", required=True)
    setup.add_argument("--name", default="agent")
    setup.add_argument("--days", type=int, default=90)
    setup.add_argument("--container")
    add(auth, "status", run_auth_status, "检查本机令牌")
    users = add(auth, "users", run_auth_users, "列出 ai-draw 账号")
    users.add_argument("--container")
    revoke = add(auth, "revoke", run_auth_revoke, "吊销并删除本机令牌")
    revoke.add_argument("--container")

    add(commands, "doctor", run_doctor, "检查服务、令牌、生成槽和 LoRA")
    add(commands, "workflows", run_workflows, "列出工作流")
    loras = add(commands, "loras", run_loras, "列出已安装的 LoRA")
    loras.add_argument("--workflow", default="qwen_image_21_t2i")
    presets = add(commands, "presets", run_presets, "列出提示词预设")
    presets.add_argument("--workflow")

    session = commands.add_parser("session", help="会话").add_subparsers(dest="action", required=True)
    new = add(session, "new", run_session_new, "新建会话（标题建议以「Agent · 」开头）")
    new.add_argument("--title", required=True)
    listing = add(session, "list", run_session_list, "列出会话")
    listing.add_argument("--limit", type=int, default=20)
    link = add(session, "link", run_session_link, "给出会话链接")
    link.add_argument("session_id")

    upload = add(commands, "upload", run_upload, "原样上传文件（保留透明和动画），返回 /uploads 地址")
    upload.add_argument("files", nargs="+")
    upload.add_argument("--flatten", metavar="COLOR", help="先把透明部分铺到这个颜色上")

    gen = add(commands, "gen", run_gen, "生成图片：等生成槽空闲，记成会话里的一轮，完成后下载结果")
    gen.add_argument("--session", required=True)
    gen.add_argument("--prompt")
    gen.add_argument("--prompt-file")
    gen.add_argument("--workflow", help="t2i / i2i / gpt 或完整工作流 ID；默认按有无参考图选 Qwen")
    gen.add_argument("--ref", action="append", help="参考图：本地文件或 /uploads 地址，可重复，顺序即 <image1>…")
    gen.add_argument("--lora", action="append", help="LoRA 名称，可带强度，如 Sen:0.6；可重复")
    gen.add_argument("--count", type=int, default=1)
    gen.add_argument("--size", help="宽x高，Qwen 要 32 的倍数")
    gen.add_argument("--seed", type=int)
    gen.add_argument("--steps", type=int, choices=(20, 25, 40, 50))
    gen.add_argument("--ref-res", type=int, choices=(512, 768, 1024, 1536, 2048))
    gen.add_argument("--original-size", dest="original_size", action="store_true", default=None)
    gen.add_argument("--no-original-size", dest="original_size", action="store_false")
    gen.add_argument("--preset", help="预设 ID（见 aidraw presets）")
    gen.add_argument("--option", action="append", help="其他工作流参数 key=value")
    gen.add_argument("--flatten", default="#ffffff", metavar="COLOR", help="透明参考图铺底颜色（默认白）")
    gen.add_argument("--keep-alpha", action="store_true", help="参考图不铺底，原样上传")
    gen.add_argument("--out", help="结果下载目录")
    gen.add_argument("--timeout", type=float, default=540, help="最长等待秒数，超时退出码 2 并给出续等命令")
    gen.add_argument("--slot-wait", type=float, default=1800, help="最多排队等待生成槽的秒数")
    job_options(gen)

    wait = add(commands, "wait", run_wait, "继续等待一个已提交的生成任务")
    wait.add_argument("task_id")
    wait.add_argument("--session", required=True)
    wait.add_argument("--message", required=True)
    wait.add_argument("--out")
    wait.add_argument("--timeout", type=float, default=540)
    job_options(wait)

    round_parser = commands.add_parser("round", help="会话轮次").add_subparsers(dest="action", required=True)
    round_get = add(round_parser, "get", run_round_get, "读取一轮的结果，可下载")
    round_get.add_argument("--session", required=True)
    round_get.add_argument("--message", required=True)
    round_get.add_argument("--out")

    post = add(commands, "post", run_post, "把处理结果作为一轮发进会话")
    post.add_argument("--session", required=True)
    post.add_argument("--text")
    post.add_argument("--text-file")
    post.add_argument("--file", action="append")
    post.add_argument("--url", action="append")
    job_options(post)

    gate = commands.add_parser("gate", help="审核关卡").add_subparsers(dest="action", required=True)
    gate_open = add(gate, "open", run_gate_open, "在会话里请用户挑选或确认")
    gate_open.add_argument("--session", required=True)
    gate_open.add_argument("--question")
    gate_open.add_argument("--question-file")
    gate_open.add_argument("--job-name", help="显示在审核条上的任务名，默认取任务日志文件名")
    gate_open.add_argument("--min", type=int, default=1)
    gate_open.add_argument("--max", type=int, default=1, help="0 表示只需确认")
    gate_open.add_argument("--round", action="append", help="建议查看的助手消息 ID")
    gate_open.add_argument("--replace", action="store_true", help="撤销这个会话里还开着的审核")
    gate_open.add_argument("--wait", action="store_true")
    gate_open.add_argument("--timeout", type=float, default=540)
    gate_open.add_argument("--download")
    job_options(gate_open)
    gate_wait = add(gate, "wait", run_gate_wait, "等待用户提交")
    gate_wait.add_argument("gate_id")
    gate_wait.add_argument("--timeout", type=float, default=540)
    gate_wait.add_argument("--download", help="把选中的结果下载到这个目录")
    job_options(gate_wait)
    gate_get = add(gate, "get", run_gate_get, "读取审核")
    gate_get.add_argument("gate_id")
    gate_list = add(gate, "list", run_gate_list, "列出审核")
    gate_list.add_argument("--session")
    gate_list.add_argument("--status", choices=("open", "submitted", "cancelled"))
    gate_list.add_argument("--limit", type=int, default=20)
    gate_cancel = add(gate, "cancel", run_gate_cancel, "撤销审核（例如用户已在对话里回答）")
    gate_cancel.add_argument("gate_id")
    gate_cancel.add_argument("--reason")
    gate_cancel.add_argument("--job")
    gate_submit = add(gate, "submit", run_gate_submit, "记录用户在对话里明确给出的选择")
    gate_submit.add_argument("gate_id")
    gate_submit.add_argument("--decision", choices=("approve", "redo"), required=True)
    gate_submit.add_argument("--pick", action="append", help="选中结果的 /uploads 地址")
    gate_submit.add_argument("--note")
    gate_submit.add_argument("--job")

    rmbg = add(commands, "rmbg", run_rmbg, "用后端抠图，结果下载到本地")
    rmbg.add_argument("source", help="本地文件或 /uploads 地址")
    rmbg.add_argument("--mode", choices=BACKGROUND_MODES, default="birefnet")
    rmbg.add_argument("--model", help="birefnet / rembg 模型，例如 joelseytre/toonout")
    rmbg.add_argument("--option", action="append", help="其他抠图参数 key=value，如 edge_threshold=30")
    rmbg.add_argument("--out")
    upscale = add(commands, "upscale", run_upscale, "用后端放大，结果下载到本地")
    upscale.add_argument("source", help="本地文件或 /uploads 地址")
    upscale.add_argument("--method", choices=UPSCALE_METHODS, default="realesrgan_anime")
    upscale.add_argument("--scale", type=int, choices=(2, 4), default=2)
    upscale.add_argument("--timeout", type=float, default=600)
    upscale.add_argument("--out")

    add(commands, "slot", run_slot, "生成槽是否空闲")
    stop = add(commands, "stop", run_stop, "停止自己的生成任务")
    stop.add_argument("--task")
    job = commands.add_parser("job", help="任务日志").add_subparsers(dest="action", required=True)
    show = add(job, "show", run_job_show, "读取任务日志")
    show.add_argument("file")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = load_config()
    client = Client(config, load_token())
    try:
        payload, code = args.handler(args, config, client)
    except CliError as error:
        emit({"ok": False, "error": str(error), "exit_code": error.code, **error.extra})
        print(f"aidraw: {error}", file=sys.stderr)
        return error.code
    except KeyboardInterrupt:
        print("aidraw: 已中断", file=sys.stderr)
        return 130
    except Exception as error:  # unexpected: still answer in JSON so the agent can read it
        emit({"ok": False, "error": f"{type(error).__name__}: {error}", "exit_code": EXIT_API})
        print(f"aidraw: {type(error).__name__}: {error}", file=sys.stderr)
        return EXIT_API
    emit(payload)
    return code
