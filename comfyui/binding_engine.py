from typing import Any, Optional


class BindingEngine:
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
                    inputs[input_name] = value
                else:
                    workflow.set_node_param(node_title, input_name, value)
                applied_counts[value_from] = applied_counts.get(value_from, 0) + 1
            except Exception:
                continue
        return applied_counts
