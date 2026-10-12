"""The aidraw CLI against a scripted stand-in for the ai-draw API."""
import contextlib
import email
import io
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aidraw_cli.cli import main  # noqa: E402

WORKFLOWS = [
    {"key": "qwen_image_21_t2i", "label": "文生图", "output_type": "image", "max_count": 16, "max_reference_images": 3,
     "supports_multi_image": True, "parameters": [{"name": "qwen_steps"}, {"name": "qwen_fixed_seed"}]},
    {"key": "qwen_image_21_i2i", "label": "图生图", "output_type": "image", "max_count": 16, "max_reference_images": 3,
     "supports_multi_image": True, "parameters": []},
    {"key": "minimax_h3", "label": "视频", "output_type": "video", "max_count": 1, "parameters": []},
]


def png_bytes(mode="RGBA", color=(255, 0, 0, 0)):
    buffer = io.BytesIO()
    Image.new(mode, (8, 8), color).save(buffer, "PNG")
    return buffer.getvalue()


class FakeAiDraw:
    """Scripted responses; `calls` records (method, path, json) for assertions."""

    def __init__(self):
        self.calls = []
        self.slot = [{"busy": False}]
        self.generate = [(200, {"task_id": "x"})]
        self.tasks = [(200, {"status": "running", "phase": "running", "artifact_count": 0}),
                      (200, {"status": "completed", "phase": "completed", "artifact_count": 2})]
        self.round_images = (["/uploads/generated/1/a.png", "/uploads/generated/1/b.png"], [11, 12])
        self.gates = [(200, {"status": "open"})]
        self.uploads = []
        self.files = {"/uploads/generated/1/a.png": png_bytes(), "/uploads/generated/1/b.png": png_bytes()}
        self.rmbg_broken = set()

    @staticmethod
    def take(queue):
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def gate(self, status="open", **extra):
        return {"gate_id": "gate-1", "session_id": "session-1", "job": None, "step": "pick", "question": "选一张",
                "min_picks": 1, "max_picks": 1, "rounds": [], "status": status, "decision": None, "picks": [],
                "note": "", "cancel_reason": None, "created_at": 1, "updated_at": 1, "submitted_at": None, **extra}

    def handle(self, method, path, query, body, content_type):
        self.calls.append((method, path, body if isinstance(body, dict) else None))
        if path == "/health":
            return 200, {"status": "healthy"}
        if path == "/api/agent/me":
            return 200, {"user_id": 1, "username": "owner"}
        if path == "/api/agent/slot":
            return 200, self.take(self.slot)
        if path == "/api/service/workflows":
            return 200, {"workflows": WORKFLOWS}
        if path == "/api/service/loras":
            return 200, {"workflow": query.get("workflow", [""])[0],
                         "models": [{"value": "Sen", "label": "Sen", "default_strength": 0.8},
                                    {"value": "Darkest Dungeon", "label": "Darkest Dungeon", "default_strength": 0.8}]}
        if path == "/api/prompt/presets":
            return 200, {"presets": [{"id": "pose", "title": "参考姿势", "prompt": "按图2姿势。", "workflow_ids": None}]}
        if path == "/api/chat/save":
            return 200, {"success": True}
        if path == "/api/media/generate":
            return self.take(self.generate)
        if path.startswith("/api/agent/tasks/"):
            return self.take(self.tasks)
        if path.startswith("/api/chat/sessions/") and "/rounds/" in path:
            reply = path.rsplit("/", 1)[-1]
            images, seeds = self.round_images
            return 200, {"messages": [{"id": reply.removesuffix("-reply"), "type": "user"},
                                      {"id": reply, "type": "assistant", "images": images, "seeds": seeds}]}
        if method == "DELETE" and "/messages/" in path:
            return 200, {"success": True}
        if path == "/api/media/remove-background":
            if (body.get("birefnet_model") or body.get("rembg_model") or body.get("inspyrenet_mode")) in self.rmbg_broken:
                return 500, {"detail": "移除背景失败: model download failed"}
            url = f"/uploads/transparent/1/t{len(self.files)}.png"
            self.files[url] = png_bytes()
            return 200, {"success": True, "image_url": url, "background_mode": body["background_mode"]}
        if path == "/api/agent/uploads":
            message = email.message_from_bytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
            data = next(part.get_payload(decode=True) for part in message.walk() if part.get_filename())
            self.uploads.append(data)
            url = f"/uploads/agent/1/202610/{len(self.uploads):032d}.png"
            self.files[url] = data
            return 200, {"url": url, "kind": "image", "format": "png", "width": 8, "height": 8, "frames": 1,
                         "has_alpha": False, "bytes": len(data)}
        if path == "/api/agent/rounds":
            return 200, {"session_id": body["session_id"], "message_id": "msg-r", "reply_id": "msg-r-reply",
                         "media": body["media"], "created_at": 1}
        if path == "/api/agent/gates" and method == "POST":
            return 200, self.gate(step=body.get("step"))
        if path.startswith("/api/agent/gates/"):
            status, extra = self.take(self.gates)
            return (status, {"detail": "审核不存在"}) if status == 404 else (200, self.gate(**extra))
        if path.startswith("/uploads/"):
            return 200, self.files[path]
        return 404, {"detail": f"no route {method} {path}"}


class StubServer:
    def __init__(self, fake):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def respond(self):
                parsed = urlparse(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                content_type = self.headers.get("Content-Type", "")
                body = json.loads(raw) if raw and content_type.startswith("application/json") else raw
                status, payload = fake.handle(self.command, parsed.path, parse_qs(parsed.query), body, content_type)
                data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "image/png" if isinstance(payload, bytes) else "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_PUT = do_DELETE = respond

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class CliTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeAiDraw()
        self.server = StubServer(self.fake)
        self.addCleanup(self.server.close)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / "config").mkdir()
        (self.root / "config" / "config.json").write_text(json.dumps({
            "yield_seconds": 0, "poll_seconds": 0.05, "slot_poll_seconds": 0.05, "gate_poll_seconds": 0.05,
        }))
        environment = patch.dict(os.environ, {
            "AIDRAW_CONFIG_DIR": str(self.root / "config"), "XDG_CACHE_HOME": str(self.root / "cache"),
            "AIDRAW_API_URL": self.server.url, "AIDRAW_PUBLIC_URL": "https://aidraw.example", "AIDRAW_TOKEN": "aidp_test",
        })
        environment.start()
        self.addCleanup(environment.stop)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(list(argv))
        return code, json.loads(out.getvalue()), err.getvalue()

    def calls(self, path):
        return [body for method, called, body in self.fake.calls if called == path]

    def test_gen_queues_for_the_slot_retries_a_lost_race_and_downloads_with_seeds(self):
        self.fake.slot = [{"busy": True, "mine": False}, {"busy": False}, {"busy": False}]
        self.fake.generate = [(409, {"detail": "已有生成任务正在运行"}), (200, {"task_id": "x"})]
        out_dir = self.root / "out"
        job = self.root / "art" / "jobs" / "heroine.jsonl"
        code, result, err = self.run_cli(
            "gen", "--session", "session-1", "--prompt", "侧视立绘", "--lora", "Sen:0.6", "--lora", "darkest dungeon",
            "--count", "2", "--size", "768x1024", "--seed", "7", "--out", str(out_dir), "--job", str(job), "--step", "style")
        self.assertEqual(code, 0, err)
        self.assertEqual(result["status"], "completed")
        self.assertEqual([(item["seed"], Path(item["file"]).exists()) for item in result["images"]], [(11, True), (12, True)])
        self.assertTrue(result["link"].startswith("https://aidraw.example/?session=session-1"))
        saves = self.calls("/api/chat/save")
        self.assertEqual(len(saves), 1, "the round is recorded once even when the submit is retried")
        self.assertEqual((saves[0]["type"], saves[0]["workflow"], saves[0]["width"], saves[0]["height"]),
                         ("user", "qwen_image_21_t2i", 768, 1024))
        generates = self.calls("/api/media/generate")
        self.assertEqual(len(generates), 2)
        self.assertEqual(generates[0]["task_id"], generates[1]["task_id"])
        self.assertEqual(generates[0]["message_id"], saves[0]["message_id"] + "-reply")
        self.assertEqual(generates[0]["lora_prompt"], "<lora:Sen:0.6> <lora:Darkest Dungeon:0.8>")
        self.assertEqual(generates[0]["workflow_options"], {"qwen_fixed_seed": 7})
        self.assertFalse(generates[0]["use_original_size"])
        events = [json.loads(line)["event"] for line in job.read_text().splitlines()]
        self.assertEqual(events, ["gen_submitted", "gen"])
        self.assertTrue(any(Path(out_dir).glob("*.json")), "a sidecar records the request and results")

    def test_local_validation_happens_before_anything_is_recorded(self):
        for argv, message in (
            (("--size", "1000x1000"), "32 的倍数"),
            (("--lora", "Nope"), "未安装或未登记"),
            (("--lora", "Sen:1.5"), "0 到 1"),
            (("--workflow", "minimax_h3"), "视频"),
            (("--count", "17"), "1–16"),
        ):
            with self.subTest(argv=argv):
                code, result, _ = self.run_cli("gen", "--session", "session-1", "--prompt", "x", *argv)
                self.assertEqual(code, 1)
                self.assertIn(message, result["error"])
        self.assertEqual(self.calls("/api/chat/save"), [])

    def test_transparent_references_are_flattened_unless_kept(self):
        reference = self.root / "ref.png"
        reference.write_bytes(png_bytes())
        self.run_cli("gen", "--session", "session-1", "--prompt", "x", "--ref", str(reference), "--out", str(self.root / "o"))
        self.run_cli("gen", "--session", "session-1", "--prompt", "x", "--ref", str(reference), "--keep-alpha",
                     "--out", str(self.root / "o"))
        modes = [Image.open(io.BytesIO(data)).mode for data in self.fake.uploads]
        self.assertEqual(modes, ["RGB", "RGBA"])
        self.assertEqual(self.calls("/api/media/generate")[0]["workflow"], "qwen_image_21_i2i")

    def test_cancelled_lost_and_timed_out_tasks_have_distinct_exits(self):
        self.fake.tasks = [(200, {"status": "error", "phase": "cancelled", "artifact_count": 1})]
        code, result, _ = self.run_cli("gen", "--session", "session-1", "--prompt", "x", "--out", str(self.root / "o"))
        self.assertEqual((code, result["status"]), (4, "cancelled"))
        self.fake.tasks = [(404, {"detail": "gone"})]
        self.fake.round_images = ([], [])
        code, result, _ = self.run_cli("gen", "--session", "session-1", "--prompt", "x", "--out", str(self.root / "o"))
        self.assertEqual((code, result["status"]), (5, "lost"))
        self.fake.tasks = [(200, {"status": "running", "phase": "running", "artifact_count": 0})]
        code, result, _ = self.run_cli("gen", "--session", "session-1", "--prompt", "x", "--timeout", "0.2")
        self.assertEqual(code, 2)
        self.assertTrue(result["resume"].startswith("aidraw wait "))

    def test_video_loops_the_first_frame_and_downloads_the_clip(self):
        frame = self.root / "base.png"
        frame.write_bytes(png_bytes())
        self.fake.round_images = (["/uploads/video/1/clip.mp4"], [99])
        self.fake.files["/uploads/video/1/clip.mp4"] = b"\x00\x00\x00\x18ftypmp42fake-video"
        code, result, err = self.run_cli("video", "--session", "session-1", "--prompt", "原地待机，轻微呼吸", "--first", str(frame),
                                         "--loop", "--seed", "7", "--out", str(self.root / "v"), "--job", str(self.root / "idle.jsonl"))
        self.assertEqual(code, 0, err)
        body = self.calls("/api/media/generate")[0]
        url = body["reference_images"][0]
        self.assertEqual((body["workflow"], body["count"], body["reference_image_end"]), ("minimax_h3", 1, url))
        self.assertEqual(body["workflow_options"], {"h3_duration": "4", "h3_aspect_ratio": "auto", "h3_audio": "silent", "h3_fixed_seed": 7})
        self.assertEqual(self.calls("/api/chat/save")[0]["reference_image_end"], url)
        self.assertEqual([Image.open(io.BytesIO(data)).mode for data in self.fake.uploads], ["RGB"], "uploaded once, flattened")
        self.assertTrue(result["images"][0]["file"].endswith(".mp4"))
        self.assertNotIn("gate", result)
        code, result, _ = self.run_cli("video", "--session", "session-1", "--prompt", "待机", "--first", str(frame), "--loop",
                                       "--out", str(self.root / "v2"), "--gate", "选一段视频")
        self.assertEqual((code, result["gate"]["gate_id"]), (0, "gate-1"), "the gate opens as soon as the clip is ready")
        self.assertEqual(self.calls("/api/agent/gates")[-1]["rounds"], [result["reply_id"]])
        self.assertTrue(Path(result["images"][0]["file"]).exists())
        code, result, _ = self.run_cli("video", "--session", "session-1", "--prompt", "x", "--first", str(frame), "--loop", "--last", str(frame))
        self.assertEqual(code, 1)

    def test_post_uploads_files_unchanged_and_creates_a_round(self):
        image = self.root / "sheet.png"
        data = png_bytes()
        image.write_bytes(data)
        code, result, _ = self.run_cli("post", "--session", "session-1", "--text", "处理结果", "--file", str(image),
                                       "--url", "/uploads/generated/1/a.png")
        self.assertEqual(code, 0)
        self.assertEqual(self.fake.uploads, [data])
        self.assertEqual(self.calls("/api/agent/rounds")[0]["media"][1], "/uploads/generated/1/a.png")
        self.assertEqual(result["reply_id"], "msg-r-reply")

    def test_rmbg_all_tries_every_web_algorithm_and_survives_a_broken_one(self):
        image = self.root / "frame.png"
        image.write_bytes(png_bytes("RGB", (255, 255, 255)))
        self.fake.rmbg_broken = {"ZhengPeng7/BiRefNet_dynamic"}
        code, result, _ = self.run_cli("rmbg", str(image), "--all", "--out", str(self.root / "cut"), "--job", str(self.root / "job.jsonl"))
        self.assertEqual(code, 0)
        bodies = self.calls("/api/media/remove-background")
        self.assertEqual(len(bodies), 13)
        self.assertEqual({body["background_mode"] for body in bodies}, {"inspyrenet", "birefnet", "ai"}, "no colour keying")
        self.assertTrue(all(body["image"].startswith("data:image/png;base64,") and "image_url" not in body for body in bodies))
        self.assertEqual(self.fake.uploads, [], "nothing is left under /uploads/agent")
        rembg = next(body for body in bodies if body["background_mode"] == "ai")
        self.assertEqual((rembg["alpha_matting"], rembg["post_process_mask"]), (True, True), "same defaults as the web form")
        failed = [item for item in result["results"] if "error" in item]
        self.assertEqual([item["variant"] for item in failed], ["birefnet-dynamic"])
        done = [item for item in result["results"] if "error" not in item]
        self.assertEqual(len(done), 12)
        self.assertTrue(all(Path(item["file"]).name == f"frame.{item['variant']}.png" and Path(item["file"]).exists() for item in done))
        self.assertIn('"failed": ["birefnet-dynamic"]', (self.root / "job.jsonl").read_text())

    def test_rmbg_one_algorithm_keeps_frame_names_and_server_paths(self):
        frames = []
        for name in ("frame_000.png", "frame_001.png"):
            frames.append(self.root / name)
            frames[-1].write_bytes(png_bytes("RGB", (255, 255, 255)))
        code, result, _ = self.run_cli("rmbg", *map(str, frames), "/uploads/generated/1/a.png", "--variant", "rembg-u2netp",
                                       "--out", str(self.root / "cut"))
        self.assertEqual(code, 0)
        self.assertEqual(sorted(path.name for path in (self.root / "cut").iterdir()), ["a.png", "frame_000.png", "frame_001.png"])
        bodies = self.calls("/api/media/remove-background")
        self.assertEqual({body["rembg_model"] for body in bodies}, {"u2netp"})
        self.assertEqual(bodies[2]["image_url"], "/uploads/generated/1/a.png")
        self.fake.rmbg_broken = {"u2netp"}
        self.assertEqual(self.run_cli("rmbg", str(frames[0]), "--variant", "rembg-u2netp")[0], 3)
        self.assertEqual(self.run_cli("rmbg", str(frames[0]), "--variant", "edge")[0], 1)
        code, listed, _ = self.run_cli("rmbg", "--list")
        self.assertEqual((code, listed["default"], len(listed["variants"])), (0, "birefnet-toonout", 13))

    def test_gate_wait_returns_the_choice_and_downloads_picks(self):
        pick = {"url": "/uploads/generated/1/b.png", "message_id": "m-reply", "image_index": 1, "seed": 12}
        self.fake.gates = [(200, {}), (200, {}), (200, {"status": "submitted", "decision": "approve", "note": "就它", "picks": [pick]})]
        code, opened, _ = self.run_cli("gate", "open", "--session", "session-1", "--question", "选一张", "--step", "pick")
        self.assertEqual((code, opened["gate"]["gate_id"]), (0, "gate-1"))
        code, result, _ = self.run_cli("gate", "wait", "gate-1", "--download", str(self.root / "picks"))
        self.assertEqual((code, result["decision"], result["note"]), (0, "approve", "就它"))
        self.assertTrue(Path(result["picks"][0]["file"]).exists())
        self.fake.gates = [(200, {"status": "cancelled", "cancel_reason": "换了"})]
        self.assertEqual(self.run_cli("gate", "wait", "gate-1")[0], 4)
        self.fake.gates = [(404, {})]
        self.assertEqual(self.run_cli("gate", "wait", "gate-1")[0], 4)
        self.fake.gates = [(200, {})]
        code, result, _ = self.run_cli("gate", "wait", "gate-1", "--timeout", "0.2")
        self.assertEqual((code, result["resume"]), (2, "aidraw gate wait gate-1"))

    def test_token_is_never_sent_over_plain_http_to_another_host(self):
        with patch.dict(os.environ, {"AIDRAW_API_URL": "http://10.1.2.3:14600"}):
            code, result, _ = self.run_cli("slot")
        self.assertEqual(code, 6)
        self.assertIn("明文 HTTP", result["error"])

    def test_auth_setup_stores_the_token_privately_and_never_prints_it(self):
        created = {"id": 3, "user": "owner", "name": "agent", "prefix": "aidp_abcdefg", "token": "aidp_secret-value",
                   "expires_at": "2027-01-01T00:00:00"}

        def fake_run(command, **_):
            self.assertEqual(command[:4], ["docker", "exec", "-i", "ai-draw-backend"])
            return type("Result", (), {"returncode": 0, "stdout": json.dumps(created) + "\n", "stderr": ""})()

        with patch("aidraw_cli.cli.subprocess.run", side_effect=fake_run):
            code, result, err = self.run_cli("auth", "setup", "--user", "owner")
        self.assertEqual(code, 0)
        self.assertNotIn("aidp_secret-value", json.dumps(result) + err)
        credentials = self.root / "config" / "credentials.json"
        self.assertEqual(json.loads(credentials.read_text())["token"], "aidp_secret-value")
        self.assertEqual(stat.S_IMODE(credentials.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
