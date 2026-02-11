import asyncio
import atexit
import base64
import json
import os
import socket
import subprocess
import tempfile
import threading
import uuid

import aiofiles
import aiohttp
import requests
import websockets
from comfy_api_simplified import ComfyApiWrapper

from comfyui.requests.comfyui_request_interface import ComfyUIRequestInterface
from comfyui.structures.comfyui_request_result import ComfyUIRequestResult
from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from utils.config_loader import get_comfyui_config, get_comfy_org_config


class LocalComfyUIRequest(ComfyUIRequestInterface):

    def __init__(self):
        # 从配置加载 ComfyUI 设置
        config = get_comfyui_config().local
        
        self.enabled = bool(getattr(config, "enabled", True))
        self.server_address = config.host
        self.server_port = config.port
        self.api_address = f"http://{self.server_address}:{self.server_port}/"
        self.comfyui_path = config.path
        self.python_executable = config.python_executable
        self.timeout = config.timeout
        self.api = ComfyApiWrapper(self.api_address)
        self.log_file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../comfyui_log.txt'))

        # 初始化服务器进程为None
        self.server_process = None
        self.log_thread = None

    def _extra_data(self) -> dict:
        config = get_comfy_org_config()
        extra: dict = {}
        if getattr(config, "auth_token", ""):
            extra["auth_token_comfy_org"] = config.auth_token
        if getattr(config, "api_key", ""):
            extra["api_key_comfy_org"] = config.api_key
        return extra

    def _queue_prompt(self, prompt: dict, client_id: str) -> str:
        payload = {"prompt": prompt, "client_id": client_id}
        extra_data = self._extra_data()
        if extra_data:
            payload["extra_data"] = extra_data
        url = f"{self.api.url.rstrip('/')}/prompt"
        resp = requests.post(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            auth=self.api.auth,
        )
        if resp.status_code != 200:
            detail = ""
            try:
                text = (resp.text or "").strip()
                if text:
                    detail = text
            except Exception:
                detail = ""
            if detail and len(detail) > 800:
                detail = detail[:800] + "...(truncated)"
            if detail:
                raise Exception(f"Request failed with status code {resp.status_code}: {resp.reason} | {detail}")
            raise Exception(f"Request failed with status code {resp.status_code}: {resp.reason}")
        return resp.json()["prompt_id"]

    async def _queue_prompt_and_wait(self, prompt: dict) -> str:
        client_id = str(uuid.uuid4())
        prompt_id = self._queue_prompt(prompt, client_id)
        async with websockets.connect(uri=self.api.ws_url.format(client_id)) as websocket:
            while True:
                out = await websocket.recv()
                if isinstance(out, str):
                    message = json.loads(out)
                    if message.get("type") == "crystools.monitor":
                        continue
                    if message.get("type") == "execution_error":
                        data = message.get("data") or {}
                        if data.get("prompt_id") == prompt_id:
                            raise Exception("Execution error occurred.")
                    if message.get("type") == "status":
                        data = message.get("data") or {}
                        status = data.get("status") or {}
                        exec_info = (status.get("exec_info") or {})
                        if exec_info.get("queue_remaining") == 0:
                            return prompt_id
                    if message.get("type") == "executing":
                        data = message.get("data") or {}
                        if data.get("node") is None and data.get("prompt_id") == prompt_id:
                            return prompt_id
        return prompt_id

    def _resolve_comfyui_main_script(self) -> tuple[str, str]:
        def has_main(dir_path: str) -> bool:
            return bool(dir_path) and os.path.isfile(os.path.join(dir_path, "main.py"))

        if has_main(self.comfyui_path):
            return os.path.join(self.comfyui_path, "main.py"), self.comfyui_path

        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        candidates = [
            os.path.join(project_root, "ComfyUI_Server"),
            os.path.join(project_root, "ComfyUI"),
        ]
        for c in candidates:
            if has_main(c):
                self.comfyui_path = c
                return os.path.join(c, "main.py"), c

        return os.path.join(self.comfyui_path, "main.py"), self.comfyui_path

    async def start_connect(self):
        """异步启动ComfyUI服务器，已启动或端口被占用则直接返回。"""
        if not self.enabled:
            return

        # 检查端口是否被占用
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        is_service_exiting = False
        try:
            sock.settimeout(1)
            result = sock.connect_ex((self.server_address, self.server_port))
            if result == 0:
                is_service_exiting = True
                print(
                    f"[LocalComfyUIRequest] 端口 {self.server_address}:{self.server_port} 已被占用，ComfyUI服务可能已在运行。")
        finally:
            sock.close()

        log_file_path = self.log_file_path
        # 用追加模式打开日志文件，防止覆盖和二进制问题
        log_file = open(log_file_path, "w")
        # 清空日志文件内容
        log_file.truncate(0)

        if not is_service_exiting:
            print(f"[LocalComfyUIRequest] 使用Python解释器: {self.python_executable}")
            main_script, cwd = self._resolve_comfyui_main_script()
            cmd = [self.python_executable, "-su", main_script, "--listen", self.server_address, "--port",
                   str(self.server_port)]
            print(f"[LocalComfyUIRequest] 启动命令: {' '.join(cmd)}")
            print("[LocalComfyUIRequest] 正在启动ComfyUI服务...")

            # 清理PYTHONPATH和PYTHONHOME，避免Krita环境污染
            env = os.environ.copy()
            env.pop("PYTHONPATH", None)
            env.pop("PYTHONHOME", None)
            env["PYTHONIOENCODING"] = "utf-8"

            self.server_process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=log_file,
                stderr=log_file,
                env=env,
                creationflags=subprocess.CREATE_NO_WINDOW
            )

        # 启动日志监控任务（线程方式）
        self.start_log_watcher_thread(log_file_path)

        # 等待服务ready（使用配置的超时时间）
        for _ in range(self.timeout):
            state = await self.get_state()
            if state.available:
                break
            await asyncio.sleep(1)
        else:
            # 终止进程
            self.close_connect()

        # 注册清理
        atexit.register(self.close_connect)

    def close_connect(self):
        """异步关闭ComfyUI服务器连接，无论状态如何都尝试清理。"""

        # sp = self.server_process
        # if not sp:
        #     return
        # try:
        #     sp.terminate()
        # except Exception as e:
        #     print(f"[LocalComfyUIRequest] 关闭ComfyUI服务时出错: {e}")
        # self.server_process = None
        #
        # # 清理日志线程
        # if self.log_thread and self.log_thread.is_alive():
        #     self.log_thread.join(timeout=1)
        #     self.log_thread = None

    def _extract_latest_error_from_log(self) -> str | None:
        try:
            if not self.log_file_path or not os.path.exists(self.log_file_path):
                return None
            with open(self.log_file_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.read().splitlines()
            for line in reversed(lines[-500:]):
                s = line.strip()
                if not s:
                    continue
                if s.startswith("Exception:"):
                    return s.removeprefix("Exception:").strip() or s
                if "Unauthorized:" in s:
                    return s
                if "No images provided" in s:
                    return s
                if s.startswith("!!! Exception during processing !!!"):
                    return "ComfyUI 执行异常（请查看 comfyui_log.txt）"
        except Exception:
            return None
        return None

    async def generate_t2i(self, workflow, prompt_text, denoise_value, lora_prompt, seed, output_node_title: str = "保存图像"):
        """
        异步发送T2I生成请求，返回ComfyRequestResult对象
        """
        try:
            prompt_id = await self._queue_prompt_and_wait(workflow)
            image_node_id = workflow.get_node_id(output_node_title)
            history = self.api.get_history(prompt_id)
            results = history[prompt_id]["outputs"][image_node_id]["images"]

            if results:
                first_result = results[0]
                base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                    first_result["type"])
                return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
            return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")
        except Exception as e:
            err = str(e)
            detail = self._extract_latest_error_from_log()
            if detail and detail not in err:
                err = f"{err} | {detail}" if err else detail
            return ComfyUIRequestResult(success=False, data=None, error=err)

    async def generate_i2i(
        self,
        workflow,
        image_b64,
        prompt_text,
        denoise_value,
        lora_prompt,
        seed,
        width=None,
        height=None,
        output_node_title: str = "保存图像",
        image_binding=None,
    ):
        """
        异步发送I2I生成请求，返回ComfyRequestResult对象
        width: 图像宽度（可选）
        height: 图像高度（可选）
        """
        # 先在系统tmp目录下根据image_b64创建临时图片
        input_filename = os.path.join(tempfile.gettempdir(), "input_image.png")
        try:
            async with aiofiles.open(input_filename, "wb") as f:
                await f.write(base64.b64decode(image_b64))
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=f"写入临时图片失败: {str(e)}")

        # 上传图片到ComfyUI
        try:
            image_metadata = self.api.upload_image(input_filename)
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=f"上传图片失败: {str(e)}")

        try:
            node_title = "main_image"
            input_name = "image"
            if isinstance(image_binding, dict):
                node_title = image_binding.get("node_title") or node_title
                input_name = image_binding.get("input_name") or input_name
            workflow.set_node_param(node_title, input_name, f"{image_metadata['subfolder']}/{image_metadata['name']}")
            print("[LocalComfyUIRequest] main_image参数设置成功")
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=f"设置参考图绑定失败: {str(e)}")

        try:
            prompt_id = await self._queue_prompt_and_wait(workflow)
            image_node_id = workflow.get_node_id(output_node_title)
            history = self.api.get_history(prompt_id)
            results = history[prompt_id]["outputs"][image_node_id]["images"]

            if results:
                first_result = results[0]
                base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                    first_result["type"])
                return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
            return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")
        except Exception as e:
            err = str(e)
            detail = self._extract_latest_error_from_log()
            if detail and detail not in err:
                err = f"{err} | {detail}" if err else detail
            return ComfyUIRequestResult(success=False, data=None, error=err)

    async def get_state(self) -> ComfyUIRequestState:
        """异步检查本地ComfyUI服务状态"""

        state = ComfyUIRequestState(type_="local", api_address=self.api_address, available=False, status="offline")

        # 检查服务器是否在线（异步方式）
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.api_address}api/system_stats", timeout=2) as response:
                    stats = await response.json()
                    if response.status == 200:
                        state.available = True
                        state.status = "ready"
                    else:
                        state.available = False
                        state.status = "not responding"
        except Exception as e:
            # print(f"检查ComfyUI服务状态时出错: {e}")
            state.available = False
            state.status = "not responding"
        return state

    def start_log_watcher_thread(self, log_file_path):
        async def log_watcher():
            last_pos = 0
            while True:
                try:
                    async with aiofiles.open(log_file_path, "rb") as f:
                        await f.seek(last_pos)
                        data = await f.read()
                        if data:
                            text = data.decode("utf-8", errors="ignore")
                            for line in text.splitlines():
                                print(f"[ComfyUI] {line.rstrip()}")
                            last_pos += len(data)
                except Exception as e:
                    print(f"[ComfyUI-LogWatcher] 读取日志出错: {e}")
                await asyncio.sleep(1)

        def run_log_watcher():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(log_watcher())

        self.log_thread = threading.Thread(target=run_log_watcher, daemon=True)
        self.log_thread.start()
