import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api.service import router
from server.auth import get_current_user


class PoseEmbeddingProbeTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router, prefix="/api")
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_probe_requires_authentication(self):
        response = self.client.get("/api/service/pose-embedding-check")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("probe", response.json())

    def test_probe_always_supplies_both_restrictions_and_cannot_be_cached(self):
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        response = self.client.get("/api/service/pose-embedding-check?check=test")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"probe": "pose-embedding-v1"})
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertEqual(response.headers["content-security-policy"], "frame-ancestors 'none'")
        self.assertEqual(response.headers["cache-control"], "no-store")
