"""Background removal through the backend's algorithms (背景处理), one variant or all of them for comparison."""
import json
import time
from pathlib import Path

from . import jobs
from .client import Client
from .errors import CliError, EXIT_API, EXIT_OK
from .generate import default_out, log
from .media import png_data_url

# The choices of 背景处理 in the web UI (frontend/src/components/BackgroundOptionsFields.tsx), each with that form's
# defaults, so picking the same entry by hand gives the same result. Colour keying (the backend's "edge" mode, 换色 in
# the UI) is left out on purpose: it cannot clear background enclosed by the subject, e.g. between an arm and the body.
INSPYRENET = {"background_mode": "inspyrenet", "inspyrenet_resize": "static"}
BIREFNET = {"background_mode": "birefnet", "birefnet_image_size": 1024, "birefnet_device": "auto", "birefnet_precision": "auto"}
REMBG = {"background_mode": "ai", "alpha_matting": True, "post_process_mask": True}
BACKGROUND_VARIANTS = {
    "inspyrenet-base": ("InSPyReNet · base", {**INSPYRENET, "inspyrenet_mode": "base"}),
    "inspyrenet-fast": ("InSPyReNet · fast", {**INSPYRENET, "inspyrenet_mode": "fast"}),
    "inspyrenet-base-nightly": ("InSPyReNet · base-nightly", {**INSPYRENET, "inspyrenet_mode": "base-nightly"}),
    "birefnet": ("BiRefNet · BiRefNet", {**BIREFNET, "birefnet_model": "ZhengPeng7/BiRefNet"}),
    "birefnet-toonout": ("BiRefNet · ToonOut", {**BIREFNET, "birefnet_model": "joelseytre/toonout"}),
    "birefnet-hr-matting": ("BiRefNet · HR-matting", {**BIREFNET, "birefnet_model": "ZhengPeng7/BiRefNet_HR-matting"}),
    "birefnet-dynamic": ("BiRefNet · dynamic", {**BIREFNET, "birefnet_model": "ZhengPeng7/BiRefNet_dynamic"}),
    "birefnet-matting": ("BiRefNet · matting", {**BIREFNET, "birefnet_model": "ZhengPeng7/BiRefNet-matting"}),
    "rembg-isnet-anime": ("rembg · isnet-anime", {**REMBG, "rembg_model": "isnet-anime"}),
    "rembg-isnet-general-use": ("rembg · isnet-general-use", {**REMBG, "rembg_model": "isnet-general-use"}),
    "rembg-u2net": ("rembg · u2net", {**REMBG, "rembg_model": "u2net"}),
    "rembg-u2netp": ("rembg · u2netp", {**REMBG, "rembg_model": "u2netp"}),
    "rembg-u2net-human-seg": ("rembg · u2net_human_seg", {**REMBG, "rembg_model": "u2net_human_seg"}),
}
DEFAULT_VARIANT = "birefnet-toonout"


def parse_options(items) -> dict:
    options = {}
    for item in items or []:
        key, _, value = item.partition("=")
        try:
            options[key] = json.loads(value)
        except ValueError:
            options[key] = value
    return options


def remove_background(client: Client, source: str, variant: str, options: dict, target: Path) -> dict:
    """Local files travel as PNG data URLs, so no copy is left under the public /uploads/agent."""
    body = {**BACKGROUND_VARIANTS[variant][1], **options}
    if source.startswith("/uploads/"):
        body["image_url"] = source
    else:
        body["image"] = png_data_url(Path(source).expanduser())
    started = time.monotonic()
    result = client.json("POST", "/api/media/remove-background", json=body, timeout=900)  # first use downloads the model
    client.download(result["image_url"], target)
    return {"url": result["image_url"], "file": str(target), "seconds": round(time.monotonic() - started, 1)}


def run_rmbg(args, config, client):
    if args.list:
        return {"ok": True, "default": DEFAULT_VARIANT,
                "variants": [{"variant": name, "label": label} for name, (label, _) in BACKGROUND_VARIANTS.items()]}, EXIT_OK
    if not args.sources:
        raise CliError("需要至少一个文件或 /uploads 地址")
    variants = list(BACKGROUND_VARIANTS) if args.all else [args.variant]
    if args.variant not in BACKGROUND_VARIANTS:
        raise CliError(f"没有这个算法：{args.variant}（aidraw rmbg --list 查看）")
    options = parse_options(args.option)
    out = Path(args.out).expanduser() if args.out else default_out("media")
    results = []
    total = len(args.sources) * len(variants)
    for source in args.sources:
        stem = Path(source).stem
        for variant in variants:
            done = len(results) + 1
            log(f"抠图 {done}/{total}：{Path(source).name} · {BACKGROUND_VARIANTS[variant][0]}", args.quiet)
            # One variant keeps the source name so frames map 1:1; a comparison tags each result with its variant.
            name = f"{stem}.{variant}.png" if args.all else f"{stem}.png"
            item = {"source": source, "variant": variant, "label": BACKGROUND_VARIANTS[variant][0]}
            try:
                item.update(remove_background(client, source, variant, options, out / name))
            except CliError as error:
                if not args.all or error.code != EXIT_API:  # in a comparison one broken model must not stop the rest
                    raise
                item["error"] = str(error)
                log(f"  失败：{error}", args.quiet)
            results.append(item)
    failed = [item for item in results if "error" in item]
    jobs.append(args.job, "rmbg", step=args.step, variants=variants, files=[item.get("file") for item in results],
                failed=[item["variant"] for item in failed])
    ok = len(failed) < len(results)
    payload = {"ok": ok, "out": str(out), "results": results}
    if not ok:
        payload["error"] = "全部算法都失败了"
    return payload, EXIT_OK if ok else EXIT_API


def add_rmbg_arguments(rmbg) -> None:
    rmbg.add_argument("sources", nargs="*", help="本地文件或 /uploads 地址，可以多个（例如一组帧）")
    rmbg.add_argument("--variant", default=DEFAULT_VARIANT, help=f"算法，默认 {DEFAULT_VARIANT}；--list 查看全部")
    rmbg.add_argument("--all", action="store_true", help="每个文件都用全部算法各抠一次，结果名带算法名，用来对比")
    rmbg.add_argument("--list", action="store_true", help="列出算法")
    rmbg.add_argument("--option", action="append", help="覆盖算法参数 key=value，如 alpha_matting=false")
    rmbg.add_argument("--out", help="输出目录")

