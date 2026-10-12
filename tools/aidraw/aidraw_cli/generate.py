"""`aidraw gen` and friends: wait for the shared slot, record the round the way the web UI does,
generate, follow the task and download the results with their seeds."""
import json
import random
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

from . import jobs
from .client import Client
from .config import cache_dir, load_state, save_state, session_link
from .errors import (
    ApiError, CliError, EXIT_API, EXIT_CANCELLED, EXIT_LOST, EXIT_SLOT, EXIT_TIMEOUT, EXIT_USAGE,
)
from .media import describe, flatten, guess_mime, url_extension

WORKFLOW_ALIASES = {"t2i": "qwen_image_21_t2i", "i2i": "qwen_image_21_i2i", "gpt": "gpt_image"}
QWEN_WORKFLOWS = {"qwen_image_21_t2i", "qwen_image_21_i2i"}
MIN_EDGE, MAX_EDGE, MAX_PIXELS = 256, 3072, 3072 * 1536
SUBMIT_ATTEMPTS = 3


def log(message: str, quiet: bool = False) -> None:
    if not quiet:
        print(message, file=sys.stderr, flush=True)


def resolve_workflow(name: Optional[str], has_refs: bool) -> str:
    workflow = WORKFLOW_ALIASES.get(name or "", name) or ("qwen_image_21_i2i" if has_refs else "qwen_image_21_t2i")
    # The web UI switches Qwen text-to-image to editing as soon as a reference is added.
    return "qwen_image_21_i2i" if workflow == "qwen_image_21_t2i" and has_refs else workflow


def workflow_meta(client: Client, workflow: str) -> dict:
    data = client.json("GET", "/api/service/workflows", auth=False)
    for item in data.get("workflows", []):
        if item.get("key") == workflow:
            return item
    known = ", ".join(item.get("key", "?") for item in data.get("workflows", []))
    raise CliError(f"未知工作流 {workflow}；可用：{known}")


def parse_size(text: Optional[str]) -> Optional[tuple[int, int]]:
    if not text:
        return None
    try:
        width, height = (int(part) for part in text.lower().split("x"))
    except ValueError as error:
        raise CliError(f"尺寸格式应为 宽x高，例如 1024x1536：{text}") from error
    return width, height


def check_qwen_size(width: int, height: int) -> None:
    for value in (width, height):
        if value % 32 or not MIN_EDGE <= value <= MAX_EDGE:
            raise CliError(f"Qwen 的宽高必须是 32 的倍数，范围 {MIN_EDGE}–{MAX_EDGE}：{width}x{height}")
    if width * height > MAX_PIXELS:
        raise CliError(f"Qwen 的总像素不能超过 3072x1536：{width}x{height}")


def lora_prompt(client: Client, workflow: str, specs: list[str]) -> str:
    """`Sen` or `Sen:0.6` → `<lora:Sen:0.6>`, checked against the LoRAs installed for this workflow."""
    if not specs:
        return ""
    if workflow not in QWEN_WORKFLOWS:
        raise CliError("只有 Qwen 工作流支持 LoRA")
    models = client.json("GET", "/api/service/loras", params={"workflow": workflow}).get("models", [])
    by_name = {}
    for model in models:
        by_name[model["value"].lower()] = model
        by_name[model["label"].lower()] = model
    tags = []
    for spec in specs:
        name, _, strength = spec.rpartition(":") if ":" in spec else (spec, "", "")
        model = by_name.get(name.strip().lower())
        if model is None:
            raise CliError(f"未安装或未登记的 LoRA：{name}；可用：{', '.join(item['label'] for item in models) or '无'}")
        try:
            value = float(strength) if strength else float(model.get("default_strength", 0.8))
        except ValueError as error:
            raise CliError(f"LoRA 强度必须是数字：{spec}") from error
        if not 0 <= value <= 1:
            raise CliError(f"LoRA 强度必须在 0 到 1 之间：{spec}")
        tags.append(f"<lora:{model['value']}:{value:g}>")
    text = " ".join(tags)
    if len(text) > 255:
        raise CliError("LoRA 组合过长（超过 255 个字符）")
    return text


def resolve_preset(client: Client, preset_id: Optional[str], workflow: str) -> Optional[dict]:
    if not preset_id:
        return None
    presets = client.json("GET", "/api/prompt/presets").get("presets", [])
    for preset in presets:
        if preset.get("id") == preset_id:
            scope = preset.get("workflow_ids")
            if scope and workflow not in scope:
                raise CliError(f"预设 {preset_id} 不适用于 {workflow}")
            return preset
    raise CliError(f"未知预设 {preset_id}；可用：{', '.join(item.get('id', '?') for item in presets)}")


def upload_file(client: Client, path: Path) -> dict:
    if not path.is_file():
        raise CliError(f"文件不存在：{path}")
    with path.open("rb") as file:
        return client.json("POST", "/api/agent/uploads", files={"file": (path.name, file, guess_mime(path))}, timeout=300)


def prepare_refs(client: Client, refs: list[str], workflow: str, flatten_color: Optional[str], quiet: bool) -> list[str]:
    """Server paths pass through; local files are uploaded, transparent ones flattened first for ComfyUI."""
    urls = []
    workdir = cache_dir() / "flattened"
    for ref in refs:
        if ref.startswith("/uploads/"):
            urls.append(ref)
            continue
        path = Path(ref).expanduser()
        facts = describe(path) if path.is_file() else None
        if facts is None:
            raise CliError(f"参考图不是可读取的图片：{ref}")
        if facts["has_alpha"] and workflow in QWEN_WORKFLOWS and flatten_color:
            log(f"参考图 {path.name} 带透明通道，先铺到 {flatten_color} 底上再上传", quiet)
            path = flatten(path, flatten_color, workdir)
        urls.append(upload_file(client, path)["url"])
    return urls


def wait_for_slot(client: Client, config: dict, max_wait: float, quiet: bool) -> None:
    started = time.monotonic()
    delay = float(config.get("slot_poll_seconds", 5))
    announced = False
    while True:
        slot = client.json("GET", "/api/agent/slot")
        if not slot.get("busy"):
            return
        waited = time.monotonic() - started
        if waited >= max_wait:
            raise CliError(f"生成槽被占用超过 {int(max_wait)} 秒，放弃提交", EXIT_SLOT, slot=slot)
        if not announced:
            owner = "你自己（网页或另一个 agent）" if slot.get("mine") else "其他用户"
            log(f"生成槽正被{owner}占用，排队等待…", quiet)
            announced = True
        time.sleep(min(delay + random.uniform(0, delay * 0.4), max(0.05, max_wait - waited)))
        delay = min(delay * 1.5, 30.0)


def honor_yield(config: dict, quiet: bool) -> None:
    finished = load_state().get("last_task_finished_at")
    gap = float(config.get("yield_seconds", 20))
    if not isinstance(finished, (int, float)) or gap <= 0:
        return
    remaining = gap - (time.time() - finished)
    if remaining > 0:
        log(f"让出生成槽 {remaining:.0f} 秒，方便你手动生成…", quiet)
        time.sleep(remaining)


def remember_finish() -> None:
    state = load_state()
    state["last_task_finished_at"] = time.time()
    save_state(state)


def delete_round(client: Client, session_id: str, message_id: str) -> None:
    try:
        client.request("DELETE", f"/api/chat/sessions/{session_id}/messages/{message_id}", allow=(404,))
    except CliError:
        pass


def fetch_round(client: Client, session_id: str, reply_id: str) -> Optional[dict]:
    response = client.request("GET", f"/api/chat/sessions/{session_id}/rounds/{reply_id}", allow=(404,))
    if response.status_code == 404:
        return None
    messages = response.json().get("messages", [])
    return next((message for message in messages if message.get("id") == reply_id), {"images": [], "seeds": []})


def download_results(client: Client, images: list[str], seeds: list, out_dir: Path, message_id: str) -> list[dict]:
    prefix = message_id.removeprefix("msg-")[:8]
    results = []
    for index, url in enumerate(images):
        seed = seeds[index] if index < len(seeds) else None
        entry = {"index": index, "url": url, "seed": seed}
        if isinstance(url, str) and url.startswith("/uploads/"):
            suffix = f"_s{seed}" if seed is not None else ""
            target = out_dir / f"{prefix}_{index:02d}{suffix}.{url_extension(url)}"
            client.download(url, target)
            facts = describe(target)
            entry["file"] = str(target)
            if facts:
                entry.update(width=facts["width"], height=facts["height"], has_alpha=facts["has_alpha"])
        results.append(entry)
    return results


def follow_task(client: Client, config: dict, *, task_id: str, session_id: str, reply_id: str,
                timeout: float, quiet: bool, total: Optional[int] = None) -> str:
    """Poll until the task ends; returns completed / error / cancelled / lost, or raises a timeout."""
    started = time.monotonic()
    poll = max(0.05, float(config.get("poll_seconds", 4)))
    last_count = -1
    while True:
        response = client.request("GET", f"/api/agent/tasks/{task_id}", allow=(404,))
        if response.status_code == 404:
            # The backend restarted (task history is in memory); the round may still hold results.
            reply = fetch_round(client, session_id, reply_id)
            return "completed" if reply and reply.get("images") else "lost"
        snapshot = response.json()
        count = int(snapshot.get("artifact_count") or 0)
        if count != last_count:
            last_count = count
            log(f"进度 {count}/{total if total else '?'}（{snapshot.get('phase')}）", quiet)
        if snapshot.get("phase") == "cancelled":
            return "cancelled"
        if snapshot.get("status") in ("completed", "error"):
            if snapshot.get("status") == "error":
                raise CliError(f"生成失败：{snapshot.get('error') or '未知错误'}", EXIT_API, task=snapshot)
            return "completed"
        if time.monotonic() - started >= timeout:
            raise CliError(
                f"等待超过 {int(timeout)} 秒，任务仍在进行", EXIT_TIMEOUT,
                resume=f"aidraw wait {task_id} --session {session_id} --message {reply_id}",
                task_id=task_id, session_id=session_id, reply_id=reply_id,
            )
        time.sleep(poll)


def finish_round(client: Client, config: dict, *, status: str, session_id: str, message_id: str, reply_id: str,
                 task_id: str, out_dir: Path, request: dict, started: float) -> dict:
    reply = fetch_round(client, session_id, reply_id) or {"images": [], "seeds": []}
    images = [url for url in reply.get("images", []) if isinstance(url, str)]
    results = download_results(client, images, reply.get("seeds") or [], out_dir, message_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    sidecar = out_dir / f"{message_id.removeprefix('msg-')[:8]}.json"
    payload = {
        "ok": status == "completed",
        "status": status,
        "session_id": session_id,
        "message_id": message_id,
        "reply_id": reply_id,
        "task_id": task_id,
        "request": request,
        "images": results,
        "link": session_link(config, session_id),
        "elapsed_s": round(time.time() - started, 1),
    }
    sidecar.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def default_out(session_id: str) -> Path:
    return cache_dir() / "out" / session_id


def run_gen(args, config: dict, client: Client) -> tuple[dict, int]:
    prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip() if args.prompt_file else (args.prompt or "")
    refs = list(args.ref or [])
    workflow = resolve_workflow(args.workflow, bool(refs))
    meta = workflow_meta(client, workflow)
    if meta.get("output_type") != "image":
        raise CliError(f"{workflow} 输出视频；视频命令在第二阶段提供，目前请在网页里操作")
    if not 1 <= args.count <= int(meta.get("max_count", 1)):
        raise CliError(f"{workflow} 每次只能生成 1–{meta.get('max_count')} 个结果")
    if refs and not meta.get("supports_multi_image") and len(refs) > 1:
        raise CliError(f"{workflow} 只接受一张参考图")
    if len(refs) > int(meta.get("max_reference_images", 3)):
        raise CliError(f"{workflow} 最多 {meta.get('max_reference_images')} 张参考图")
    if not prompt and not args.preset:
        raise CliError("需要 --prompt、--prompt-file 或 --preset")

    size = parse_size(args.size)
    options: dict = {}
    for item in args.option or []:
        key, separator, value = item.partition("=")
        if not separator:
            raise CliError(f"--option 格式应为 key=value：{item}")
        try:
            options[key] = json.loads(value)
        except ValueError:
            options[key] = value
    use_original_size = True
    if workflow in QWEN_WORKFLOWS:
        if size:
            check_qwen_size(*size)
            use_original_size = False
        elif workflow == "qwen_image_21_t2i":
            size = (1024, 1024)
            use_original_size = False
        if args.seed is not None:
            options["qwen_fixed_seed"] = args.seed
        if args.steps:
            options["qwen_steps"] = str(args.steps)
        if args.ref_res:
            if workflow != "qwen_image_21_i2i":
                raise CliError("--ref-res 只用于带参考图的 Qwen 编辑")
            options["qwen_reference_resolution"] = str(args.ref_res)
    elif args.seed is not None or args.steps or args.ref_res:
        raise CliError(f"{workflow} 不支持 --seed/--steps/--ref-res")
    if args.original_size is not None:
        use_original_size = args.original_size

    lora = lora_prompt(client, workflow, args.lora or [])
    preset = resolve_preset(client, args.preset, workflow)
    ref_urls = prepare_refs(client, refs, workflow, None if args.keep_alpha else args.flatten, args.quiet)
    width, height = size if size else (None, None)
    request = {
        "workflow": workflow, "prompt": prompt, "count": args.count, "lora_prompt": lora,
        "reference_images": ref_urls or None, "width": width, "height": height,
        "use_original_size": use_original_size, "workflow_options": options or None,
        "prompt_preset": preset,
    }
    out_dir = Path(args.out).expanduser() if args.out else default_out(args.session)

    started = time.time()
    message_id = f"msg-{uuid.uuid4()}"
    reply_id = f"{message_id}-reply"
    task_id = uuid.uuid4().hex
    saved = False
    for attempt in range(1, SUBMIT_ATTEMPTS + 1):
        honor_yield(config, args.quiet)
        wait_for_slot(client, config, args.slot_wait, args.quiet)
        if not saved:
            message = {key: value for key, value in {
                "session_id": args.session, "message_id": message_id, "type": "user", "content": prompt,
                "workflow": workflow, "count": args.count, "lora_prompt": lora or None,
                "width": width, "height": height, "use_original_size": use_original_size,
                "reference_images": ref_urls or None, "workflow_options": options or None,
                "prompt_preset": preset,
            }.items() if value is not None}
            client.json("POST", "/api/chat/save", json=message)
            saved = True
        body = {key: value for key, value in request.items() if value is not None}
        body.update(session_id=args.session, message_id=reply_id, task_id=task_id)
        try:
            client.json("POST", "/api/media/generate", json=body)
            break
        except ApiError as error:
            if error.status == 409 and attempt < SUBMIT_ATTEMPTS:
                slot = client.json("GET", "/api/agent/slot")
                if slot.get("task_id") == task_id:
                    break  # our own submission went through before the error surfaced
                log("提交时生成槽刚被占用，重新排队…", args.quiet)
                continue
            delete_round(client, args.session, message_id)
            raise
    log(f"已提交：{session_link(config, args.session)}", args.quiet)
    jobs.append(args.job, "gen_submitted", step=args.step, session_id=args.session, message_id=message_id,
                reply_id=reply_id, task_id=task_id, request=request)

    status = follow_and_record(client, config, args, task_id=task_id, session_id=args.session,
                               reply_id=reply_id, total=args.count)
    payload = finish_round(client, config, status=status, session_id=args.session, message_id=message_id,
                           reply_id=reply_id, task_id=task_id, out_dir=out_dir, request=request, started=started)
    jobs.append(args.job, "gen", step=args.step, **{key: payload[key] for key in (
        "status", "session_id", "message_id", "reply_id", "task_id", "request", "images")})
    return payload, exit_code_for(status)


def follow_and_record(client: Client, config: dict, args, *, task_id: str, session_id: str, reply_id: str,
                      total: Optional[int] = None) -> str:
    """Follow the task; any end except a timeout frees the slot, which starts the yield gap."""
    try:
        status = follow_task(client, config, task_id=task_id, session_id=session_id, reply_id=reply_id,
                             timeout=args.timeout, quiet=args.quiet, total=total)
    except CliError as error:
        if error.code != EXIT_TIMEOUT:
            remember_finish()
            jobs.append(args.job, "gen_failed", step=args.step, session_id=session_id, reply_id=reply_id,
                        task_id=task_id, error=str(error))
        raise
    remember_finish()
    return status


def exit_code_for(status: str) -> int:
    return {"completed": 0, "cancelled": EXIT_CANCELLED, "lost": EXIT_LOST}.get(status, EXIT_API)


def run_wait(args, config: dict, client: Client) -> tuple[dict, int]:
    reply_id = args.message if args.message.endswith("-reply") else f"{args.message}-reply"
    message_id = reply_id.removesuffix("-reply")
    started = time.time()
    status = follow_and_record(client, config, args, task_id=args.task_id, session_id=args.session, reply_id=reply_id)
    out_dir = Path(args.out).expanduser() if args.out else default_out(args.session)
    payload = finish_round(client, config, status=status, session_id=args.session, message_id=message_id,
                           reply_id=reply_id, task_id=args.task_id, out_dir=out_dir, request={}, started=started)
    jobs.append(args.job, "gen", step=args.step, **{key: payload[key] for key in (
        "status", "session_id", "message_id", "reply_id", "task_id", "images")})
    return payload, exit_code_for(status)


def run_round_get(args, config: dict, client: Client) -> tuple[dict, int]:
    reply_id = args.message if args.message.endswith("-reply") else f"{args.message}-reply"
    reply = fetch_round(client, args.session, reply_id)
    if reply is None:
        raise CliError("这一轮不存在", EXIT_API)
    images = [url for url in reply.get("images", []) if isinstance(url, str)]
    seeds = reply.get("seeds") or []
    if args.out:
        results = download_results(client, images, seeds, Path(args.out).expanduser(), reply_id.removesuffix("-reply"))
    else:
        results = [{"index": index, "url": url, "seed": seeds[index] if index < len(seeds) else None}
                   for index, url in enumerate(images)]
    return {"ok": True, "session_id": args.session, "reply_id": reply_id, "images": results}, 0


def run_post(args, config: dict, client: Client) -> tuple[dict, int]:
    # Local files first (in the given order), then existing /uploads URLs.
    media = [upload_file(client, Path(file).expanduser())["url"] for file in args.file or []]
    media.extend(args.url or [])
    if not media:
        raise CliError("至少需要一个 --file 或 --url", EXIT_USAGE)
    text = Path(args.text_file).read_text(encoding="utf-8") if args.text_file else (args.text or "")
    result = client.json("POST", "/api/agent/rounds", json={"session_id": args.session, "text": text, "media": media})
    result.update(ok=True, link=session_link(config, args.session))
    jobs.append(args.job, "post", step=args.step, session_id=args.session, message_id=result["message_id"],
                reply_id=result["reply_id"], text=text, media=result["media"])
    return result, 0
