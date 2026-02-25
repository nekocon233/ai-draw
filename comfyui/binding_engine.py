import re
from typing import Any, Optional


class BindingEngine:
    _LORA_PROMPT_RE = re.compile(r"<lora:([^:>]+):([^>]+)>")

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
    def _parse_lora_prompt(value: Any) -> list[tuple[str, float]]:
        if not isinstance(value, str):
            return []
        out: list[tuple[str, float]] = []
        for m in BindingEngine._LORA_PROMPT_RE.finditer(value):
            name = (m.group(1) or "").strip()
            raw = (m.group(2) or "").strip()
            if not name:
                continue
            try:
                strength = float(raw)
            except Exception:
                continue
            out.append((name, strength))
        return out

    @staticmethod
    def _apply_transform(node: dict, transform: str, value: Any) -> bool:
        if transform == "easy_lorastack_from_lora_prompt":
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                inputs = {}
                node["inputs"] = inputs
            loras = BindingEngine._parse_lora_prompt(value)
            max_slots = 10
            used = min(len(loras), max_slots)
            inputs["toggle"] = 1 if used > 0 else 0
            if isinstance(inputs.get("mode"), str):
                pass
            else:
                inputs["mode"] = "simple"
            inputs["num_loras"] = max(1, used)
            for i in range(1, max_slots + 1):
                if i <= used:
                    name, strength = loras[i - 1]
                    inputs[f"lora_{i}_name"] = name
                    inputs[f"lora_{i}_strength"] = strength
                    inputs[f"lora_{i}_model_strength"] = strength
                    inputs[f"lora_{i}_clip_strength"] = strength
                else:
                    inputs[f"lora_{i}_name"] = "None"
                    inputs[f"lora_{i}_strength"] = 1.0
                    inputs[f"lora_{i}_model_strength"] = 1.0
                    inputs[f"lora_{i}_clip_strength"] = 1.0
            return True
        return False

    @staticmethod
    def apply(workflow: Any, bindings: list[dict], values: dict) -> dict[str, int]:
        applied_counts: dict[str, int] = {}
        for b in bindings or []:
            node_title = b.get("node_title")
            input_name = b.get("input_name")
            value_from = b.get("value_from")
            node_id = b.get("node_id")
            transform = b.get("transform")
            if not value_from or (not node_title and not node_id):
                continue
            if not transform and not input_name:
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
                    if transform:
                        if not BindingEngine._apply_transform(node, str(transform), value):
                            continue
                    else:
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
                            if transform:
                                if BindingEngine._apply_transform(node, str(transform), value):
                                    changed = True
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
                    if not changed and not b.get("optional"):
                        raise ValueError(f"Node '{node_title}' not found.")
                applied_counts[value_from] = applied_counts.get(value_from, 0) + 1
            except Exception:
                continue
        return applied_counts
