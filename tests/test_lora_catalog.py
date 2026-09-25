import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.ai_draw_service import get_ai_draw_service
from server.api.service import router
from server.auth import get_current_user
from server.lora_catalog import installed_lora_names, workflow_lora_options


class LoraCatalogTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "configs/app_config.yaml"
        self.metadata = yaml.safe_load(path.read_text(encoding="utf-8"))["workflow_defaults"]["workflow_metadata"]
        self.installed = [
            "Ameniwa.safetensors", "AmeniwaQwen21V3.safetensors",
            "AmeniwaQwen21Bilingual.safetensors", "AmeniwaQwen21.safetensors",
            "AmeniwaZ.safetensors", "AmeniwaZ_30000.safetensors",
            "pixel_art_style_z_image_turbo.safetensors", "Wan2.1-360_epoch20.safetensors",
            "other/checkpoint.safetensors",
        ]
        self.node = {"input": {"required": {"lora_name": [self.installed]}}}

    def test_filters_by_architecture_and_installed_exact_path(self):
        metadata = {"lora_models": [
            {"name": "AmeniwaQwen21Bilingual.safetensors", "label": "style"},
            {"name": "AmeniwaQwen21.safetensors", "label": "other version"},
            {"name": "checkpoint.safetensors", "label": "missing"},
        ]}
        options = workflow_lora_options(metadata, self.node)
        self.assertEqual([item["value"] for item in options], ["AmeniwaQwen21Bilingual", "AmeniwaQwen21"])

    def test_current_catalog_excludes_retired_workflows_and_incompatible_installed_models(self):
        self.assertNotIn("t2i", self.metadata)
        for workflow in ("qwen_image_21_t2i", "qwen_image_21_i2i"):
            # The bilingual adapter is installed as Ameniwa; files under retired names stay unlisted.
            self.assertEqual(workflow_lora_options(self.metadata[workflow], self.node), [
                {"value": "Ameniwa", "label": "Ameniwa", "default_strength": 0.8},
            ])
            default = next(item["default"] for item in self.metadata[workflow]["parameters"] if item["name"] == "lora_prompt")
            self.assertEqual(default, "")

    def test_reads_legacy_and_combo_node_schemas(self):
        combo = {"input": {"required": {"lora_name": ["COMBO", {"options": self.installed}]}}}
        self.assertEqual(installed_lora_names({"LoraLoaderModelOnly": self.node}), set(self.installed))
        self.assertEqual(installed_lora_names(combo), set(self.installed))

    def test_empty_inventory_is_distinct_from_invalid_node_response(self):
        self.assertEqual(installed_lora_names({"input": {"required": {"lora_name": [[]]}}}), set())
        for invalid in ({}, {"input": None}, {"input": {"required": {"lora_name": []}}}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                installed_lora_names(invalid)

    def client(self, authenticated=True):
        def metadata(workflow):
            if workflow not in self.metadata:
                raise ValueError("未知工作流")
            return self.metadata[workflow]

        self.service = SimpleNamespace(
            catalog=SimpleNamespace(metadata=metadata),
            get_comfyui_object_info=AsyncMock(return_value=self.node),
        )
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_ai_draw_service] = lambda: self.service
        if authenticated:
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        client = TestClient(app)
        self.addCleanup(client.close)
        return client

    def test_list_requires_authentication(self):
        response = self.client(authenticated=False).get("/api/service/loras?workflow=qwen_image_21_t2i")
        self.assertEqual(response.status_code, 401)
        self.service.get_comfyui_object_info.assert_not_awaited()

    def test_authenticated_list_returns_selectable_models(self):
        response = self.client().get("/api/service/loras?workflow=qwen_image_21_t2i")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["workflow"], "qwen_image_21_t2i")
        self.assertEqual(body["models"][0]["value"], "Ameniwa")
        self.assertEqual(body["models"][0]["default_strength"], 0.8)

    def test_unknown_or_non_lora_workflow_never_queries_comfyui(self):
        client = self.client()
        self.assertEqual(client.get("/api/service/loras?workflow=unknown").status_code, 404)
        self.assertEqual(client.get("/api/service/loras?workflow=gpt_image").json()["models"], [])
        for retired in ("t2i", "i2i", "ideogram_t2i", "ideogram_style"):
            self.assertEqual(client.get("/api/service/loras?workflow=" + retired).status_code, 404)
        self.service.get_comfyui_object_info.assert_not_awaited()

    def test_comfyui_failure_is_recoverable_and_does_not_leak_connection_details(self):
        client = self.client()
        self.service.get_comfyui_object_info.side_effect = RuntimeError("private connection details")
        response = client.get("/api/service/loras?workflow=qwen_image_21_t2i")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private", response.text)
