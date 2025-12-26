import asyncio
import atexit
import base64
import os
import socket
import subprocess
import tempfile
import threading

import aiofiles
import aiohttp
from comfy_api_simplified import ComfyApiWrapper

from comfyui.requests.comfyui_request_interface import ComfyUIRequestInterface
from comfyui.structures.comfyui_request_result import ComfyUIRequestResult
from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from utils.config_loader import get_comfyui_config


class LocalComfyUIRequest(ComfyUIRequestInterface):

    def __init__(self):
        # 从配置加载 ComfyUI 设置
        config = get_comfyui_config().local
        
        self.server_address = config.host
        self.server_port = config.port
        self.api_address = f"http://{self.server_address}:{self.server_port}/"
        self.comfyui_path = config.path
        self.python_executable = config.python_executable
        self.timeout = config.timeout
        self.api = ComfyApiWrapper(self.api_address)

        # 初始化服务器进程为None
        self.server_process = None
        self.log_thread = None

    async def start_connect(self):
        """异步启动ComfyUI服务器，已启动或端口被占用则直接返回。"""

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

        log_file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../comfyui_log.txt'))
        # 用追加模式打开日志文件，防止覆盖和二进制问题
        log_file = open(log_file_path, "w")
        # 清空日志文件内容
        log_file.truncate(0)

        if not is_service_exiting:
            print(f"[LocalComfyUIRequest] 使用Python解释器: {self.python_executable}")
            main_script = os.path.join(self.comfyui_path, "main.py")
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
                cwd=self.comfyui_path,
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

    async def generate_t2i(self, workflow, prompt_text, denoise_value, lora_prompt, seed):
        """
        异步发送T2I生成请求，返回ComfyRequestResult对象
        """
        # 设置workflow参数
        try:
            workflow.set_node_param("positive_prompt", "positive", prompt_text)
            print("[LocalComfyUIRequest] positive_prompt参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置positive_prompt参数失败: {str(e)}")

        try:
            workflow.set_node_param("lora_prompt", "positive", lora_prompt)
            print(f"[LocalComfyUIRequest] lora_prompt参数设置成功: {lora_prompt}")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置lora_prompt参数失败: {str(e)}")

        try:
            workflow.set_node_param("seed", "value", seed)
            print("[LocalComfyUIRequest] seed参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置seed参数失败: {str(e)}")

        print("[LocalComfyUIRequest] T2I workflow参数设置完成")

        # 执行工作流
        prompt_id = await self.api.queue_prompt_and_wait(workflow)
        image_node_id = workflow.get_node_id("保存图像")
        history = self.api.get_history(prompt_id)
        results = history[prompt_id]["outputs"][image_node_id]["images"]

        if results:
            first_result = results[0]
            base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                first_result["type"])
            return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
        return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")

    async def generate_i2i(self, workflow, image_b64, prompt_text, denoise_value, lora_prompt, seed):
        """
        异步发送I2I生成请求，返回ComfyRequestResult对象
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

        # 设置workflow参数
        try:
            workflow.set_node_param("main_image", "image", f"{image_metadata['subfolder']}/{image_metadata['name']}")
            print("[LocalComfyUIRequest] main_image参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置main_image参数失败: {str(e)}")

        try:
            workflow.set_node_param("positive_prompt", "positive", prompt_text)
            print("[LocalComfyUIRequest] positive_prompt参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置positive_prompt参数失败: {str(e)}")

        try:
            workflow.set_node_param("denoise", "value", denoise_value)
            print("[LocalComfyUIRequest] denoise参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置denoise参数失败: {str(e)}")

        try:
            workflow.set_node_param("lora_prompt", "positive", lora_prompt)
            print(f"[LocalComfyUIRequest] lora_prompt参数设置成功: {lora_prompt}")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置lora_prompt参数失败: {str(e)}")

        try:
            workflow.set_node_param("seed", "value", seed)
            print("[LocalComfyUIRequest] seed参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置seed参数失败: {str(e)}")

        print("[LocalComfyUIRequest] I2I workflow参数设置完成")

        # 执行工作流
        prompt_id = await self.api.queue_prompt_and_wait(workflow)
        image_node_id = workflow.get_node_id("保存图像")
        history = self.api.get_history(prompt_id)
        results = history[prompt_id]["outputs"][image_node_id]["images"]

        if results:
            first_result = results[0]
            base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                first_result["type"])
            return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
        return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")

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
