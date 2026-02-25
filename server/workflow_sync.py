import hashlib
import json
import os
from typing import Optional

from utils.config_loader import get_config
from server.database import SessionLocal
from server.models import WorkflowDefinition


def _normalize_json_text(json_text: str) -> str:
    obj = json.loads(json_text)
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_text_with_fallback(path: str) -> str:
    for encoding in ("utf-8", "gbk"):
        try:
            with open(path, "r", encoding=encoding) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def _detect_requires_image(workflow_dict: dict) -> bool:
    for node in workflow_dict.values():
        if isinstance(node, dict) and node.get("class_type") == "LoadImage":
            return True
        meta = (node.get("_meta") or {}) if isinstance(node, dict) else {}
        title = str(meta.get("title") or "")
        if title == "main_image":
            return True
    return False


def _detect_output_node_title(workflow_dict: dict) -> str:
    for node in workflow_dict.values():
        if isinstance(node, dict) and node.get("class_type") == "SaveImage":
            meta = node.get("_meta") or {}
            title = meta.get("title")
            if title:
                return title
    return "保存图像"


def _is_api_format_workflow(workflow_dict: dict) -> bool:
    if not isinstance(workflow_dict, dict):
        return False
    if isinstance(workflow_dict.get("nodes"), list):
        return False
    for node in workflow_dict.values():
        if isinstance(node, dict) and node.get("class_type"):
            return True
    return False


def _default_parameters(requires_image: bool) -> list[dict]:
    if requires_image:
        return [
            {"name": "strength", "label": "重绘强度", "type": "number", "min": 0, "max": 1, "step": 0.01, "default": 0.8},
            {"name": "count", "label": "生成数量", "type": "number", "min": 1, "max": 8, "step": 1, "default": 1},
            {"name": "width", "label": "图像宽度", "type": "number", "min": 512, "max": 2048, "step": 64, "default": 1024},
            {"name": "height", "label": "图像高度", "type": "number", "min": 512, "max": 2048, "step": 64, "default": 1024},
            {"name": "lora_prompt", "label": "LoRA 提示词", "type": "text", "default": ""},
        ]
    return [
        {"name": "count", "label": "生成数量", "type": "number", "min": 1, "max": 8, "step": 1, "default": 1},
        {"name": "width", "label": "图像宽度", "type": "number", "min": 512, "max": 2048, "step": 64, "default": 1024},
        {"name": "height", "label": "图像高度", "type": "number", "min": 512, "max": 2048, "step": 64, "default": 1024},
        {"name": "lora_prompt", "label": "LoRA 提示词", "type": "text", "default": ""},
    ]


def _default_bindings(requires_image: bool) -> list[dict]:
    base = [
        {"value_from": "prompt", "node_title": "positive_prompt", "input_name": "positive", "value_type": "str"},
        {"value_from": "lora_prompt", "node_title": "lora_prompt", "input_name": "positive", "value_type": "str"},
        {"value_from": "seed", "node_title": "seed", "input_name": "value", "value_type": "int"},
        {"value_from": "width", "node_title": "width", "input_name": "value", "value_type": "int"},
        {"value_from": "height", "node_title": "height", "input_name": "value", "value_type": "int"},
    ]
    if requires_image:
        base.extend([
            {"value_from": "strength", "node_title": "denoise", "input_name": "value", "value_type": "float"},
            {"value_from": "uploaded_image_path", "node_title": "main_image", "input_name": "image", "value_type": "str"},
        ])
    return base


def _collect_node_titles(workflow_dict: dict) -> set[str]:
    titles: set[str] = set()
    for node in workflow_dict.values():
        if not isinstance(node, dict):
            continue
        meta = node.get("_meta") or {}
        title = meta.get("title")
        if title:
            titles.add(str(title))
    return titles


def _parse_bindings(text: str | None) -> list[dict]:
    if not text:
        return []
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _bindings_miss_critical_nodes(workflow_dict: dict, bindings: list[dict]) -> bool:
    titles = _collect_node_titles(workflow_dict)
    ids = set(str(k) for k in workflow_dict.keys())
    required: set[str] = {"prompt"}
    has_sampler_seed = False
    has_latent_size = False
    has_easy_lora_stack = False
    for node in workflow_dict.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        class_type = node.get("class_type")
        if class_type == "easy loraStack":
            has_easy_lora_stack = True
        if isinstance(class_type, str) and class_type.startswith("KSampler") and "noise_seed" in inputs:
            has_sampler_seed = True
        if class_type == "EmptyLatentImage" and ("width" in inputs or "height" in inputs):
            has_latent_size = True
    if has_sampler_seed:
        required.add("seed")
    if has_latent_size:
        required.update({"width", "height"})
    if has_easy_lora_stack:
        required.add("lora_prompt")
    ok: set[str] = set()
    for b in bindings or []:
        value_from = b.get("value_from")
        if value_from not in required:
            continue
        node_id = b.get("node_id")
        node_title = b.get("node_title")
        if node_id and str(node_id) in ids:
            ok.add(value_from)
            continue
        if node_title and str(node_title) in titles:
            ok.add(value_from)
            continue
    return not required.issubset(ok)


def _auto_generate_bindings(workflow_dict: dict, requires_image: bool) -> list[dict]:
    bindings: list[dict] = []

    positive_clip_ids: list[str] = []
    prompt_input_ids: list[tuple[str, str]] = []
    seed_input_ids: list[tuple[str, str]] = []
    sampler_ids: list[str] = []
    latent_ids: list[str] = []
    denoise_ids: list[str] = []
    load_image_titles: list[str] = []
    easy_lora_stack_titles: list[str] = []

    for node_id, node in workflow_dict.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        class_type = node.get("class_type")
        if "prompt" in inputs:
            prompt_input_ids.append((str(node_id), "prompt"))
        if "seed" in inputs:
            seed_input_ids.append((str(node_id), "seed"))
        if class_type == "CLIPTextEncode":
            text = inputs.get("text")
            if isinstance(text, str):
                lowered = text.lower()
                if "watermark" not in lowered and "negative" not in lowered:
                    positive_clip_ids.append(str(node_id))
        if isinstance(class_type, str) and class_type.startswith("KSampler"):
            if "noise_seed" in inputs:
                sampler_ids.append(str(node_id))
            if requires_image and "denoise" in inputs:
                denoise_ids.append(str(node_id))
        if class_type == "EmptyLatentImage":
            if "width" in inputs or "height" in inputs:
                latent_ids.append(str(node_id))
        if class_type == "LoadImage":
            meta = node.get("_meta") or {}
            title = meta.get("title")
            if title:
                load_image_titles.append(str(title))
        if class_type == "easy loraStack":
            meta = node.get("_meta") or {}
            title = meta.get("title")
            if title:
                easy_lora_stack_titles.append(str(title))

    for nid, input_name in prompt_input_ids:
        bindings.append({"value_from": "prompt", "node_id": nid, "input_name": input_name, "value_type": "str"})

    for nid in positive_clip_ids:
        bindings.append({"value_from": "prompt", "node_id": nid, "input_name": "text", "value_type": "str"})

    for nid, input_name in seed_input_ids:
        bindings.append({"value_from": "seed", "node_id": nid, "input_name": input_name, "value_type": "int"})

    for nid in sampler_ids:
        bindings.append({"value_from": "seed", "node_id": nid, "input_name": "noise_seed", "value_type": "int"})

    for nid in latent_ids:
        bindings.append({"value_from": "width", "node_id": nid, "input_name": "width", "value_type": "int"})
        bindings.append({"value_from": "height", "node_id": nid, "input_name": "height", "value_type": "int"})

    if requires_image:
        for nid in denoise_ids:
            bindings.append({"value_from": "strength", "node_id": nid, "input_name": "denoise", "value_type": "float"})
        image_node_title = load_image_titles[0] if load_image_titles else "main_image"
        bindings.append({"value_from": "uploaded_image_path", "node_title": image_node_title, "input_name": "image", "value_type": "str"})

    if easy_lora_stack_titles:
        bindings.append({
            "value_from": "lora_prompt",
            "node_title": easy_lora_stack_titles[0],
            "input_name": "toggle",
            "transform": "easy_lorastack_from_lora_prompt",
        })

    return bindings


def sync_workflows_from_directory() -> dict:
    config = get_config()
    workflows_dir = config.paths.workflows
    if not workflows_dir or not os.path.isdir(workflows_dir):
        return {"imported": 0, "updated": 0, "skipped_conflict": 0}

    db = SessionLocal()
    try:
        imported = 0
        updated = 0
        skipped_conflict = 0

        for name in os.listdir(workflows_dir):
            if not name.lower().endswith(".json"):
                continue
            key = os.path.splitext(name)[0]
            path = os.path.join(workflows_dir, name)
            try:
                raw_text = _read_text_with_fallback(path)
                normalized = _normalize_json_text(raw_text)
                workflow_dict = json.loads(normalized)
            except Exception:
                continue

            if not _is_api_format_workflow(workflow_dict):
                row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == key).first()
                if row and row.is_custom and row.enabled:
                    row.enabled = False
                    row.description = "不支持该工作流 JSON 格式，请导出 ComfyUI 的 API 格式（workflow_api.json）"
                    updated += 1
                continue

            requires_image = _detect_requires_image(workflow_dict)
            output_node_title = _detect_output_node_title(workflow_dict)
            row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == key).first()
            if row and not row.is_custom and row.workflow_json:
                skipped_conflict += 1
                continue

            parameters = _default_parameters(requires_image)
            candidate_bindings = _auto_generate_bindings(workflow_dict, requires_image)
            if _bindings_miss_critical_nodes(workflow_dict, candidate_bindings):
                candidate_bindings = _default_bindings(requires_image)

            existing_bindings = _parse_bindings(row.bindings_json) if row else []
            bindings = candidate_bindings
            if existing_bindings and not _bindings_miss_critical_nodes(workflow_dict, existing_bindings):
                bindings = existing_bindings

            metadata = {
                "label": key,
                "description": "",
                "requires_image": requires_image,
                "generator_type": "i2i" if requires_image else "t2i",
                "parameters": parameters,
                "bindings": bindings,
                "output_node_title": output_node_title,
            }
            content_hash = _sha256(
                json.dumps({"workflow": workflow_dict, "metadata": metadata}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )

            if row is None:
                row = WorkflowDefinition(
                    key=key,
                    label=key,
                    description="",
                    enabled=True,
                    requires_image=requires_image,
                    generator_type="i2i" if requires_image else "t2i",
                    parameters_json=json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    bindings_json=json.dumps(bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    workflow_json=normalized,
                    output_node_title=output_node_title,
                    is_custom=True,
                    builtin_version=None,
                    content_hash=content_hash,
                )
                db.add(row)
                imported += 1
                continue

            if row.content_hash != content_hash:
                row.label = row.label or key
                row.requires_image = requires_image
                row.generator_type = "i2i" if requires_image else "t2i"
                row.parameters_json = row.parameters_json or json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                if not row.bindings_json or _bindings_miss_critical_nodes(workflow_dict, _parse_bindings(row.bindings_json)):
                    row.bindings_json = json.dumps(bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                row.workflow_json = normalized
                row.output_node_title = output_node_title
                row.is_custom = True
                row.builtin_version = None
                row.content_hash = content_hash
                updated += 1

        db.commit()
        return {"imported": imported, "updated": updated, "skipped_conflict": skipped_conflict}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
