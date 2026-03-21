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

    def _remove_unused_image_nodes(self, workflow, has_img2: bool, has_img3: bool):
        """
        从 workflow 中删除未使用的可选图片节点（main_image_1 / main_image_2）及其引用。
        workflow 是 ComfyWorkflowWrapper（继承自 dict），可直接操作。
        按从后往前的顺序处理，确保 has_img2=False 时也删除 main_image_1。
        """
        titles_to_remove = []
        if not has_img3:
            titles_to_remove.append("main_image_2")
        if not has_img2:
            titles_to_remove.append("main_image_1")

        for title in titles_to_remove:
            # 查找节点 ID
            node_id = None
            for nid, node in list(workflow.items()):
                if node.get("_meta", {}).get("title") == title:
                    node_id = nid
                    break
            if node_id is None:
                print(f"[LocalComfyUIRequest] 未找到节点 '{title}'，跳过")
                continue

            # 删除节点本身
            del workflow[node_id]
            print(f"[LocalComfyUIRequest] 已从 workflow 移除节点: {title} (id={node_id})")

            # 清理其他节点中所有指向该节点的输入项
            for node in workflow.values():
                inputs = node.get("inputs", {})
                keys_to_delete = [
                    k for k, v in inputs.items()
                    if isinstance(v, list) and len(v) >= 1 and str(v[0]) == str(node_id)
                ]
                for k in keys_to_delete:
                    del inputs[k]
                    print(f"[LocalComfyUIRequest] 已清理对节点 {node_id}({title}) 的引用: inputs['{k}']")

    async def _queue_and_poll(self, workflow, timeout: int = 3600, poll_interval: float = 3.0) -> str:
        """
        提交工作流并轮询历史 API 等待完成，避免 WebSocket 超时导致挂死。
        返回 prompt_id，超时或失败时抛出异常。
        """
        # queue_prompt 返回 {"prompt_id": "...", "number": ..., "node_errors": {}}
        resp = await asyncio.to_thread(self.api.queue_prompt, workflow)
        prompt_id = resp["prompt_id"]
        print(f"[LocalComfyUIRequest] 任务已提交 prompt_id={prompt_id}，开始轮询...")

        elapsed = 0.0
        while elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            try:
                history = await asyncio.to_thread(self.api.get_history, prompt_id)
                if prompt_id in history:
                    status_str = history[prompt_id].get("status", {}).get("status_str", "")
                    if status_str == "success":
                        print(f"[LocalComfyUIRequest] 任务完成 (耗时 {elapsed:.0f}s)")
                        return prompt_id
                    if status_str in ("error", "failed"):
                        msgs = history[prompt_id].get("status", {}).get("messages", [])
                        raise RuntimeError(f"ComfyUI 执行失败: {msgs}")
            except RuntimeError:
                raise
            except Exception as e:
                print(f"[LocalComfyUIRequest] 轮询出错（继续重试）: {e}")

        raise TimeoutError(f"ComfyUI 执行超时（{timeout}s）")

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

        # 执行工作流（使用 HTTP 轮询，避免 WebSocket 超时）
        prompt_id = await self._queue_and_poll(workflow)
        image_node_id = workflow.get_node_id("保存图像")
        history = await asyncio.to_thread(self.api.get_history, prompt_id)
        results = history[prompt_id]["outputs"][image_node_id]["images"]

        if results:
            first_result = results[0]
            base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                first_result["type"])
            return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
        return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")

    async def generate_i2i(self, workflow, image_b64, prompt_text, denoise_value, lora_prompt, seed, width=None, height=None, image_base64_2=None, image_base64_3=None):
        """
        异步发送I2I生成请求，返回ComfyRequestResult对象
        """
        # 根据实际传入的图片数量，删除未使用的可选节点，避免默认图片干扰结果
        self._remove_unused_image_nodes(workflow, has_img2=bool(image_base64_2), has_img3=bool(image_base64_3))

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
            img_path = (
                f"{image_metadata['subfolder']}/{image_metadata['name']}"
                if image_metadata.get('subfolder')
                else image_metadata['name']
            )
            workflow.set_node_param("main_image", "image", img_path)
            print("[LocalComfyUIRequest] main_image参数设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置main_image参数失败: {str(e)}")

        # 设置第 2 张参考图（可选）
        if image_base64_2:
            try:
                input_filename_2 = os.path.join(tempfile.gettempdir(), "input_image_2.png")
                async with aiofiles.open(input_filename_2, "wb") as f:
                    await f.write(base64.b64decode(image_base64_2))
                image_metadata_2 = self.api.upload_image(input_filename_2)
                img_path_2 = (
                    f"{image_metadata_2['subfolder']}/{image_metadata_2['name']}"
                    if image_metadata_2.get('subfolder')
                    else image_metadata_2['name']
                )
                workflow.set_node_param("main_image_1", "image", img_path_2)
                print("[LocalComfyUIRequest] main_image_1参数设置成功")
            except Exception as e:
                print(f"[LocalComfyUIRequest] 设置main_image_1参数失败: {str(e)}")

        # 设置第 3 张参考图（可选）
        if image_base64_3:
            try:
                input_filename_3 = os.path.join(tempfile.gettempdir(), "input_image_3.png")
                async with aiofiles.open(input_filename_3, "wb") as f:
                    await f.write(base64.b64decode(image_base64_3))
                image_metadata_3 = self.api.upload_image(input_filename_3)
                img_path_3 = (
                    f"{image_metadata_3['subfolder']}/{image_metadata_3['name']}"
                    if image_metadata_3.get('subfolder')
                    else image_metadata_3['name']
                )
                workflow.set_node_param("main_image_2", "image", img_path_3)
                print("[LocalComfyUIRequest] main_image_2参数设置成功")
            except Exception as e:
                print(f"[LocalComfyUIRequest] 设置main_image_2参数失败: {str(e)}")

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

        # 执行工作流（使用 HTTP 轮询，避免 WebSocket 超时）
        prompt_id = await self._queue_and_poll(workflow)
        image_node_id = workflow.get_node_id("保存图像")
        history = await asyncio.to_thread(self.api.get_history, prompt_id)
        results = history[prompt_id]["outputs"][image_node_id]["images"]

        if results:
            first_result = results[0]
            base64_content = self.api.get_image(first_result["filename"], first_result["subfolder"],
                                                first_result["type"])
            return ComfyUIRequestResult(success=True, data=base64.b64encode(base64_content).decode('utf-8'), error="")
        return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")

    async def generate_flf2v(
        self,
        workflow,
        start_image_base64: str,
        end_image_base64: str,
        prompt_start: str,
        prompt_end: str,
        seed: int,
        is_loop: bool = False,
        start_frame_count=None,
        end_frame_count=None,
        frame_rate=None,
    ):
        """
        首尾帧生视频（FLF2V）请求
        """
        # 写入并上传开始帧图片
        start_filename = os.path.join(tempfile.gettempdir(), "flf2v_start.png")
        end_filename = os.path.join(tempfile.gettempdir(), "flf2v_end.png")
        try:
            async with aiofiles.open(start_filename, "wb") as f:
                await f.write(base64.b64decode(start_image_base64))
            async with aiofiles.open(end_filename, "wb") as f:
                await f.write(base64.b64decode(end_image_base64))
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=f"写入临时图片失败: {str(e)}")

        try:
            start_meta = self.api.upload_image(start_filename)
            end_meta = self.api.upload_image(end_filename)
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=f"上传图片失败: {str(e)}")

        # 设置开始帧图片
        try:
            workflow.set_node_param("main_image_start", "image",
                f"{start_meta['subfolder']}/{start_meta['name']}" if start_meta.get('subfolder') else start_meta['name'])
            print("[LocalComfyUIRequest] main_image_start 设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 main_image_start 失败: {e}")

        # 设置结束帧图片
        try:
            workflow.set_node_param("main_image_end", "image",
                f"{end_meta['subfolder']}/{end_meta['name']}" if end_meta.get('subfolder') else end_meta['name'])
            print("[LocalComfyUIRequest] main_image_end 设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 main_image_end 失败: {e}")

        # 设置开始帧提示词
        try:
            workflow.set_node_param("positive_prompt_start", "positive", prompt_start)
            print("[LocalComfyUIRequest] positive_prompt_start 设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 positive_prompt_start 失败: {e}")

        # 设置结束帧提示词
        try:
            workflow.set_node_param("positive_prompt_end", "positive", prompt_end)
            print("[LocalComfyUIRequest] positive_prompt_end 设置成功")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 positive_prompt_end 失败: {e}")

        # 设置 seed
        try:
            workflow.set_node_param("seed", "value", seed)
            print(f"[LocalComfyUIRequest] seed 设置成功: {seed}")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 seed 失败: {e}")

        # 设置 isLoop
        try:
            workflow.set_node_param("isLoop", "value", is_loop)
            print(f"[LocalComfyUIRequest] isLoop 设置成功: {is_loop}")
        except Exception as e:
            print(f"[LocalComfyUIRequest] 设置 isLoop 失败: {e}")

        # 设置 startFrameCount
        if start_frame_count is not None:
            try:
                workflow.set_node_param("startFrameCount", "value", start_frame_count)
                print(f"[LocalComfyUIRequest] startFrameCount 设置成功: {start_frame_count}")
            except Exception as e:
                print(f"[LocalComfyUIRequest] 设置 startFrameCount 失败: {e}")

        # 设置 endFrameCount
        if end_frame_count is not None:
            try:
                workflow.set_node_param("endFrameCount", "value", end_frame_count)
                print(f"[LocalComfyUIRequest] endFrameCount 设置成功: {end_frame_count}")
            except Exception as e:
                print(f"[LocalComfyUIRequest] 设置 endFrameCount 失败: {e}")

        # 设置 frameRate
        if frame_rate is not None:
            try:
                workflow.set_node_param("frameRate", "value", float(frame_rate))
                print(f"[LocalComfyUIRequest] frameRate 设置成功: {frame_rate}")
            except Exception as e:
                print(f"[LocalComfyUIRequest] 设置 frameRate 失败: {e}")

        print("[LocalComfyUIRequest] FLF2V workflow 参数设置完成")

        # 执行工作流 - 使用轮询替代 WebSocket 等待，避免长时间生成超时卡死
        prompt_id = await self._queue_and_poll(workflow, timeout=3600)
        video_node_id = workflow.get_node_id("保存视频")
        history = await asyncio.to_thread(self.api.get_history, prompt_id)
        node_output = history[prompt_id]["outputs"].get(video_node_id, {})
        print(f"[LocalComfyUIRequest] FLF2V 视频节点输出 keys: {list(node_output.keys())}")

        # SaveVideo 节点可能用 'videos'、'gifs' 或 'images'（mp4）作为字段
        results = node_output.get("videos") or node_output.get("gifs") or node_output.get("images") or []
        if results:
            first_result = results[0]
            video_bytes = self.api.get_image(
                first_result["filename"],
                first_result.get("subfolder", ""),
                first_result.get("type", "output"),
            )
            return ComfyUIRequestResult(
                success=True,
                data=base64.b64encode(video_bytes).decode('utf-8'),
                error="",
            )
        return ComfyUIRequestResult(success=False, data=None, error="FLF2V 未获得有效视频结果")

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
