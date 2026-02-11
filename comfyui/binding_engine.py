from typing import Any, Optional


class BindingEngine:
    @staticmethod
    def _is_safe_overwrite(existing: Any, value: Any) -> bool:
        if existing is None:
            return True
        if isinstance(existing, (list, dict)) and not isinstance(value, (list, dict)):
            return False
        if isinstance(existing, (int, float)) and isinstance(value, (int, float)):
            return True
        if isinstance(existing, bool) and isinstance(value, bool):
            return True
        if isinstance(existing, str) and isinstance(value, str):
            return True
        return True

    @staticmethod
    def find_binding(bindings: list[dict], value_from: str) -> Optional[dict]:
        for b in bindings or []:
            if b.get("value_from") == value_from:
                return b
        return None

    @staticmethod
    def apply(workflow: Any, bindings: list[dict], values: dict) -> dict[str, int]:
        applied_counts: dict[str, int] = {}
        for b in bindings or []:
            node_title = b.get("node_title")
            input_name = b.get("input_name")
            value_from = b.get("value_from")
            node_id = b.get("node_id")
            if not input_name or not value_from or (not node_title and not node_id):
                continue

            if value_from not in values:
                continue

            value = values.get(value_from)
            if value is None:
                continue

            value_type = b.get("value_type")
            try:
                if value_type == "int":
                    value = int(value)
                elif value_type == "float":
                    value = float(value)
                elif value_type == "str":
                    value = str(value)
                elif value_type == "bool":
                    value = bool(value)
            except Exception:
                pass

            try:
                if node_id:
                    node = workflow.get(str(node_id)) if hasattr(workflow, "get") else None
                    if not isinstance(node, dict):
                        raise ValueError(f"Node '{node_id}' not found.")
                    inputs = node.get("inputs")
                    if not isinstance(inputs, dict):
                        inputs = {}
                        node["inputs"] = inputs
                    existing = inputs.get(input_name)
                    if not BindingEngine._is_safe_overwrite(existing, value):
                        continue
                    inputs[input_name] = value
                else:
                    changed = False
                    if hasattr(workflow, "values"):
                        for node in workflow.values():
                            if not isinstance(node, dict):
                                continue
                            meta = node.get("_meta") or {}
                            title = meta.get("title")
                            if title != node_title:
                                continue
                            inputs = node.get("inputs")
                            if not isinstance(inputs, dict):
                                inputs = {}
                                node["inputs"] = inputs
                            existing = inputs.get(input_name)
                            if not BindingEngine._is_safe_overwrite(existing, value):
                                continue
                            inputs[input_name] = value
                            changed = True
                    if not changed:
                        raise ValueError(f"Node '{node_title}' not found.")
                applied_counts[value_from] = applied_counts.get(value_from, 0) + 1
            except Exception:
                continue
        return applied_counts
