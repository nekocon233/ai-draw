import hashlib
import json
import os
import sys


def _project_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


sys.path.insert(0, _project_root())


def _read_text_with_fallback(path: str) -> str:
    for encoding in ("utf-8", "gbk"):
        try:
            with open(path, "r", encoding=encoding) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"无法读取文件（编码失败）: {path}")


def _normalize_json_text(json_text: str) -> str:
    obj = json.loads(json_text)
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _detect_output_node_title(workflow_dict: dict) -> str:
    for node in workflow_dict.values():
        if isinstance(node, dict) and node.get("class_type") == "SaveImage":
            meta = node.get("_meta") or {}
            title = meta.get("title")
            if title:
                return title
    return "保存图像"


def main() -> int:
    from utils.config_loader import get_config
    from server.database import init_db, SessionLocal
    from server.models import WorkflowDefinition

    init_db()
    config = get_config()
    workflow_defaults = config.workflow_defaults
    if not workflow_defaults:
        print("未找到 workflow_defaults，无法导入")
        return 1

    workflows_dir = config.paths.workflows
    workflow_files = workflow_defaults.workflow_files or {}
    workflow_metadata = workflow_defaults.workflow_metadata or {}
    builtin_version = config.app.version

    db = SessionLocal()
    try:
        imported = 0
        updated = 0
        skipped_custom = 0

        for key, filename in workflow_files.items():
            workflow_path = os.path.join(workflows_dir, filename)
            if not os.path.exists(workflow_path):
                print(f"跳过: 工作流文件不存在: {workflow_path}")
                continue

            raw_text = _read_text_with_fallback(workflow_path)
            workflow_json = _normalize_json_text(raw_text)
            workflow_dict = json.loads(workflow_json)

            meta = workflow_metadata.get(key) or {}
            combined_hash_source = json.dumps(
                {
                    "workflow": workflow_dict,
                    "metadata": meta,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            content_hash = _sha256(combined_hash_source)

            parameters = meta.get("parameters", [])
            parameters_json = json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

            output_node_title = _detect_output_node_title(workflow_dict)
            requires_image = bool(meta.get("requires_image", False))
            generator_type = "i2i" if requires_image else "t2i"
            default_bindings = [
                {"value_from": "prompt", "node_title": "positive_prompt", "input_name": "positive", "value_type": "str"},
                {"value_from": "lora_prompt", "node_title": "lora_prompt", "input_name": "positive", "value_type": "str"},
                {"value_from": "seed", "node_title": "seed", "input_name": "value", "value_type": "int"},
            ]
            if requires_image:
                default_bindings.extend([
                    {"value_from": "strength", "node_title": "denoise", "input_name": "value", "value_type": "float"},
                    {"value_from": "width", "node_title": "width", "input_name": "value", "value_type": "int"},
                    {"value_from": "height", "node_title": "height", "input_name": "value", "value_type": "int"},
                    {"value_from": "uploaded_image_path", "node_title": "main_image", "input_name": "image", "value_type": "str"},
                ])
            bindings_json = json.dumps(default_bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

            row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == key).first()
            if row and row.is_custom:
                skipped_custom += 1
                continue

            if row is None:
                row = WorkflowDefinition(
                    key=key,
                    label=meta.get("label", key),
                    description=meta.get("description", ""),
                    enabled=True,
                    requires_image=requires_image,
                    generator_type=generator_type,
                    parameters_json=parameters_json,
                    bindings_json=bindings_json,
                    workflow_json=workflow_json,
                    output_node_title=output_node_title,
                    is_custom=False,
                    builtin_version=builtin_version,
                    content_hash=content_hash,
                )
                db.add(row)
                imported += 1
                continue

            if row.content_hash != content_hash:
                enabled = row.enabled
                row.label = meta.get("label", key)
                row.description = meta.get("description", "")
                row.enabled = enabled
                row.requires_image = requires_image
                row.generator_type = generator_type
                row.parameters_json = parameters_json
                if not row.bindings_json:
                    row.bindings_json = bindings_json
                row.workflow_json = workflow_json
                row.output_node_title = output_node_title
                row.is_custom = False
                row.builtin_version = builtin_version
                row.content_hash = content_hash
                updated += 1

        db.commit()
        print(f"导入完成: 新增 {imported}，更新 {updated}，跳过自定义 {skipped_custom}")
        return 0
    except Exception as e:
        db.rollback()
        print(f"导入失败: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
