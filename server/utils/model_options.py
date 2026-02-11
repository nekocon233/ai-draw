import os
import time
from dataclasses import dataclass
from typing import Iterable

import yaml
import requests

from utils.config_loader import get_config, get_comfyui_config


@dataclass(frozen=True)
class ModelOptions:
    checkpoints: list[str]
    loras: list[str]
    unets: list[str]


_CACHE_TTL_SECONDS = 10
_cache_expires_at: float = 0
_cache_mtime: float | None = None
_cache_value: ModelOptions | None = None
_cache_meta: dict | None = None


def _iter_dirs_from_extra_model_paths(config_path: str, model_type: str) -> Iterable[str]:
    if not os.path.exists(config_path):
        return []
    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    yaml_dir = os.path.dirname(os.path.abspath(config_path))
    results: list[str] = []
    default_subdirs = {
        "unet": ["models/unet", "models/diffusion_models"],
        "unets": ["models/unet", "models/diffusion_models"],
        "diffusion_models": ["models/diffusion_models", "models/unet"],
    }

    for key in data:
        conf = data.get(key) or {}
        if not isinstance(conf, dict):
            continue
        base_path = conf.get("base_path")
        if base_path:
            base_path = os.path.expandvars(os.path.expanduser(str(base_path)))
            if not os.path.isabs(base_path):
                base_path = os.path.abspath(os.path.join(yaml_dir, base_path))
        raw = conf.get(model_type)
        if not raw:
            if base_path and model_type in default_subdirs:
                for sub in default_subdirs[model_type]:
                    candidate = os.path.normpath(os.path.join(base_path, sub))
                    results.append(candidate)
            continue
        for line in str(raw).split("\n"):
            line = line.strip()
            if not line:
                continue
            full_path = line
            if base_path:
                full_path = os.path.join(base_path, full_path)
            elif not os.path.isabs(full_path):
                full_path = os.path.abspath(os.path.join(yaml_dir, full_path))
            results.append(os.path.normpath(full_path))

    return results


def _default_extra_model_paths_candidates() -> list[str]:
    config = get_config()
    candidates: list[str] = []

    comfy_path = getattr(getattr(config, "comfyui", None), "local", None)
    comfy_dir = getattr(comfy_path, "path", None) if comfy_path else None
    if comfy_dir:
        candidates.append(os.path.join(comfy_dir, "extra_model_paths.yaml"))

    repo_candidate = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ComfyUI_Server", "extra_model_paths.yaml")
    candidates.append(repo_candidate)

    return candidates


def _scan_files(dirs: Iterable[str], exts: set[str]) -> list[str]:
    items: set[str] = set()
    for base_dir in dirs:
        if not os.path.isdir(base_dir):
            continue
        for root, _, filenames in os.walk(base_dir):
            for name in filenames:
                _, ext = os.path.splitext(name.lower())
                if ext not in exts:
                    continue
                full_path = os.path.join(root, name)
                rel_path = os.path.relpath(full_path, base_dir)
                rel_path = rel_path.replace("\\", "/")
                items.add(rel_path)
    return sorted(items, key=lambda s: s.lower())


def _extract_combo_options(node_info: dict, field: str) -> list[str]:
    try:
        inputs = node_info.get("input") or {}
        required = inputs.get("required") or {}
        optional = inputs.get("optional") or {}
        spec = required.get(field) or optional.get(field)
        if not isinstance(spec, (list, tuple)) or not spec:
            return []
        first = spec[0]
        if isinstance(first, list) and all(isinstance(x, str) for x in first):
            return [str(x).strip() for x in first if str(x).strip()]
    except Exception:
        return []
    return []


def _get_model_options_from_comfyui_api() -> tuple[ModelOptions | None, str | None]:
    cfg = get_comfyui_config().local
    host = getattr(cfg, "host", None) or "127.0.0.1"
    port = getattr(cfg, "port", None) or 8188

    endpoints = [
        f"http://{host}:{port}/object_info",
        f"http://{host}:{port}/api/object_info",
    ]
    obj = None
    used = None
    for url in endpoints:
        try:
            resp = requests.get(url, timeout=2)
            if resp.status_code != 200:
                continue
            obj = resp.json()
            if isinstance(obj, dict):
                used = url
                break
        except Exception:
            continue

    if not isinstance(obj, dict):
        return None, None

    checkpoints: set[str] = set()
    unets: set[str] = set()
    loras: set[str] = set()

    ckpt_nodes = ["CheckpointLoaderSimple", "CheckpointLoader"]
    for node_name in ckpt_nodes:
        node = obj.get(node_name)
        if isinstance(node, dict):
            checkpoints.update(_extract_combo_options(node, "ckpt_name"))

    unet_nodes = ["UNETLoader"]
    for node_name in unet_nodes:
        node = obj.get(node_name)
        if isinstance(node, dict):
            unets.update(_extract_combo_options(node, "unet_name"))

    lora_nodes = [
        "LoraLoader",
        "LoraLoaderModelOnly",
        "LoRALoader",
        "LoRALoaderModelOnly",
        "PCLazyLoraLoader",
    ]
    for node_name in lora_nodes:
        node = obj.get(node_name)
        if isinstance(node, dict):
            loras.update(_extract_combo_options(node, "lora_name"))

    value = ModelOptions(
        checkpoints=sorted(checkpoints, key=lambda s: s.lower()),
        loras=sorted(loras, key=lambda s: s.lower()),
        unets=sorted(unets, key=lambda s: s.lower()),
    )
    return value, used


def get_model_options_meta() -> dict:
    global _cache_meta
    return _cache_meta or {"source": "unknown", "counts": {"checkpoints": 0, "loras": 0, "unets": 0}}


def get_model_options() -> ModelOptions:
    global _cache_expires_at, _cache_mtime, _cache_value, _cache_meta

    now = time.time()
    if _cache_value is not None and now < _cache_expires_at:
        return _cache_value

    config_path = None
    for cand in _default_extra_model_paths_candidates():
        if os.path.exists(cand):
            config_path = cand
            break

    mtime = os.path.getmtime(config_path) if config_path else None
    if _cache_value is not None and _cache_mtime is not None and mtime is not None and mtime == _cache_mtime:
        _cache_expires_at = now + _CACHE_TTL_SECONDS
        return _cache_value

    options, used_url = _get_model_options_from_comfyui_api()
    if options is not None:
        _cache_value = options
        _cache_mtime = mtime
        _cache_expires_at = now + _CACHE_TTL_SECONDS
        _cache_meta = {
            "source": "comfyui_api",
            "source_url": used_url or "",
            "counts": {
                "checkpoints": len(options.checkpoints),
                "loras": len(options.loras),
                "unets": len(options.unets),
            },
        }
        print(f"[ModelOptions] source=comfyui_api checkpoints={len(options.checkpoints)} loras={len(options.loras)} unets={len(options.unets)}")
        return options

    checkpoints_dirs = _iter_dirs_from_extra_model_paths(config_path, "checkpoints") if config_path else []
    loras_dirs = _iter_dirs_from_extra_model_paths(config_path, "loras") if config_path else []
    unets_dirs: list[str] = []
    for key in ("unet", "unets", "diffusion_models"):
        unets_dirs.extend(_iter_dirs_from_extra_model_paths(config_path, key) if config_path else [])

    yaml_checkpoints = _scan_files(checkpoints_dirs, exts={".safetensors", ".ckpt"})
    yaml_loras = _scan_files(loras_dirs, exts={".safetensors", ".pt"})
    yaml_unets = _scan_files(unets_dirs, exts={".safetensors", ".pt"})

    value = ModelOptions(checkpoints=yaml_checkpoints, loras=yaml_loras, unets=yaml_unets)
    _cache_value = value
    _cache_mtime = mtime
    _cache_expires_at = now + _CACHE_TTL_SECONDS
    _cache_meta = {
        "source": "yaml_scan",
        "source_path": config_path or "",
        "counts": {
            "checkpoints": len(value.checkpoints),
            "loras": len(value.loras),
            "unets": len(value.unets),
        },
    }
    print(f"[ModelOptions] source=yaml_scan checkpoints={len(value.checkpoints)} loras={len(value.loras)} unets={len(value.unets)}")
    return value
