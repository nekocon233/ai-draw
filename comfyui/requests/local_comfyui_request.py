import asyncio
import atexit
import base64
import os
import socket
import subprocess
import tempfile
import threading
import uuid
from io import BytesIO

import aiofiles
import aiohttp
from comfy_api_simplified import ComfyApiWrapper
from PIL import Image, ImageOps

from comfyui.requests.comfyui_request_interface import ComfyUIRequestInterface
from comfyui.structures.comfyui_request_result import ComfyUIRequestResult
from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from comfyui.structures.minimax_h3 import (
    get_minimax_h3_frame_count,
    get_minimax_h3_resolution,
    remove_nodes_by_title,
)
from comfyui.structures.upscale_models import extract_upscale_model_options
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
        self._task_prompt_ids = {}

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

    @staticmethod
    def _set_required_node_param(workflow, title: str, input_name: str, value) -> None:
        try:
            workflow.set_node_param(title, input_name, value)
        except Exception as error:
            raise ValueError(f"MiniMax H3 工作流缺少参数节点 {title}.{input_name}") from error

    async def get_upscale_models(self) -> list[str]:
        """读取 ComfyUI UpscaleModelLoader 当前可选模型。"""
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{self.api_address}object_info/UpscaleModelLoader") as response:
                response.raise_for_status()
                payload = await response.json()
        return extract_upscale_model_options(payload)

    async def get_object_info(self, node_name: str) -> dict:
        """读取单个 ComfyUI 节点定义；节点不存在时返回空字典。"""
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{self.api_address}object_info/{node_name}") as response:
                if response.status == 404:
                    return {}
                response.raise_for_status()
                payload = await response.json()
        return payload.get(node_name, {}) if isinstance(payload, dict) else {}

    async def _cancel_prompt(self, prompt_id: str, *, interrupt: bool) -> None:
        """Delete this request from ComfyUI's queue and interrupt it if already running."""
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            try:
                async with session.post(
                    f"{self.api_address}queue",
                    json={"delete": [prompt_id]},
                ) as response:
                    response.raise_for_status()
            except Exception as error:
                print(f"[LocalComfyUIRequest] 删除排队任务失败 prompt_id={prompt_id}: {error}")

            if interrupt:
                try:
                    async with session.post(
                        f"{self.api_address}interrupt",
                        json={"prompt_id": prompt_id},
                    ) as response:
                        response.raise_for_status()
                except Exception as error:
                    print(f"[LocalComfyUIRequest] 中断任务失败 prompt_id={prompt_id}: {error}")

    async def interrupt(self, task=None) -> None:
        prompt_id = self._task_prompt_ids.get(task)
        if prompt_id:
            await self._cancel_prompt(prompt_id, interrupt=True)

    async def _upload_overwrite_image(
        self,
        input_filename: str,
        remote_filename: str,
        upload_type: str = "input",
    ) -> dict:
        """上传图片并覆盖同名文件。"""
        async with aiofiles.open(input_filename, "rb") as file:
            content = await file.read()
        form = aiohttp.FormData()
        form.add_field("image", content, filename=remote_filename, content_type="image/png")
        form.add_field("type", upload_type)
        form.add_field("subfolder", "ai_draw")
        form.add_field("overwrite", "true")
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{self.api_address}upload/image", data=form) as response:
                response.raise_for_status()
                return await response.json()

    async def _queue_and_poll(self, workflow, timeout: int = 3600, poll_interval: float = 3.0) -> str:
        """
        提交工作流并轮询历史 API 等待完成，避免 WebSocket 超时导致挂死。
        返回 prompt_id，超时或失败时抛出异常。
        """
        # Shield the short submission call so cancellation cannot orphan a prompt whose ID was lost.
        queue_task = asyncio.create_task(asyncio.to_thread(self.api.queue_prompt, workflow))
        try:
            resp = await asyncio.shield(queue_task)
        except asyncio.CancelledError as cancellation:
            try:
                resp = await queue_task
                prompt_id = resp.get("prompt_id")
                if prompt_id:
                    await asyncio.shield(self._cancel_prompt(prompt_id, interrupt=True))
            except Exception as error:
                print(f"[LocalComfyUIRequest] 取消提交中的任务失败: {error}")
            raise cancellation

        prompt_id = resp["prompt_id"]
        owner_task = asyncio.current_task()
        if owner_task is not None:
            self._task_prompt_ids[owner_task] = prompt_id
        print(f"[LocalComfyUIRequest] 任务已提交 prompt_id={prompt_id}，开始轮询...")

        try:
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

            await self._cancel_prompt(prompt_id, interrupt=True)
            raise TimeoutError(f"ComfyUI 执行超时（{timeout}s）")
        except asyncio.CancelledError as cancellation:
            await asyncio.shield(self._cancel_prompt(prompt_id, interrupt=True))
            raise cancellation
        finally:
            if owner_task is not None and self._task_prompt_ids.get(owner_task) == prompt_id:
                self._task_prompt_ids.pop(owner_task, None)

    async def generate_qwen_image_21(
        self, workflow, prompt_text, images, loras, seed, width, height,
        use_original_size, steps, reference_resolution,
    ):
        from utils.config_loader import get_config
        from comfyui.structures.qwen_image_21 import attach_qwen_loras

        config = get_config().qwen_image_21
        workflow.set_node_param("qwen_model", "unet_name", config.model)
        workflow.set_node_param("qwen_text_encoder", "clip_name", config.text_encoder)
        workflow.set_node_param("qwen_vae", "vae_name", config.vae)
        workflow.set_node_param("qwen_prompt", "prompt", prompt_text)
        workflow.set_node_param("qwen_prompt", "resolution", reference_resolution)
        workflow.set_node_param("qwen_sampler", "seed", seed)
        workflow.set_node_param("qwen_sampler", "steps", steps)
        workflow.set_node_param("qwen_latent", "width", width)
        workflow.set_node_param("qwen_latent", "height", height)
        workflow.set_node_param("qwen_sampler", "latent_image", ["5", 0])
        attach_qwen_loras(workflow, loras)

        # Unique upload names avoid old reference reuse. Only actual images become nodes.
        with tempfile.TemporaryDirectory(prefix="ai_draw_qwen21_") as directory:
            for index, image in enumerate(images, 1):
                filename = os.path.join(directory, f"reference_{index}.png")
                async with aiofiles.open(filename, "wb") as file:
                    await file.write(base64.b64decode(image))
                uploaded = await self._upload_overwrite_image(filename, f"qwen21_{uuid.uuid4().hex}.png")
                image_path = "/".join(filter(None, (uploaded.get("subfolder"), uploaded["name"])))
                node_id = str(20 + index)
                workflow[node_id] = {
                    "class_type": "LoadImage", "inputs": {"image": image_path},
                    "_meta": {"title": f"qwen_reference_{index}"},
                }
                workflow.set_node_param("qwen_prompt", f"images.image_{index}", [node_id, 0])
            if images:
                workflow.set_node_param("qwen_prompt", "vae", ["3", 0])
                if use_original_size:
                    workflow.set_node_param("qwen_sampler", "latent_image", ["4", 2])
            prompt_id = await self._queue_and_poll(workflow)
            history = await asyncio.to_thread(self.api.get_history, prompt_id)
            outputs = history[prompt_id]["outputs"].get(workflow.get_node_id("保存图像"), {}).get("images", [])
            if not outputs:
                return ComfyUIRequestResult(success=False, data=None, error="Qwen-Image-2.1 未返回图片")
            item = outputs[0]
            content = await asyncio.to_thread(self.api.get_image, item["filename"], item["subfolder"], item["type"])
            return ComfyUIRequestResult(success=True, data=base64.b64encode(content).decode("ascii"), error="")

    async def upscale_image(self, workflow, image_b64: str, model_name: str, scale: int, native_scale: int) -> ComfyUIRequestResult:
        """通过独立模型放大工作流处理单张 RGB 图片。"""
        input_filename = os.path.join(tempfile.gettempdir(), "ai_draw_upscale_input.png")
        try:
            raw_image = await asyncio.to_thread(base64.b64decode, image_b64)
            async with aiofiles.open(input_filename, "wb") as file:
                await file.write(raw_image)
            image_metadata = await self._upload_overwrite_image(input_filename, "upscale_input.png")
            img_path = (
                f"{image_metadata['subfolder']}/{image_metadata['name']}"
                if image_metadata.get('subfolder')
                else image_metadata['name']
            )
            workflow.set_node_param("main_image", "image", img_path)
            workflow.set_node_param("upscale_model", "model_name", model_name)
            workflow.set_node_param("output_scale", "scale_by", scale / native_scale)

            prompt_id = await self._queue_and_poll(workflow, timeout=540)
            image_node_id = workflow.get_node_id("保存图像")
            history = await asyncio.to_thread(self.api.get_history, prompt_id)
            results = history[prompt_id]["outputs"][image_node_id]["images"]
            if not results:
                return ComfyUIRequestResult(success=False, data=None, error="未获得有效结果")
            first_result = results[0]
            content = await asyncio.to_thread(
                self.api.get_image,
                first_result["filename"],
                first_result["subfolder"],
                first_result["type"],
            )
            return ComfyUIRequestResult(
                success=True,
                data=base64.b64encode(content).decode('utf-8'),
                error="",
            )
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=str(e))
        finally:
            try:
                os.unlink(input_filename)
            except OSError:
                pass

    async def upscale_image_invsr(
        self,
        workflow,
        image_b64: str,
        scale: int,
        sd_model: str,
        invsr_model: str,
        dtype: str,
        chopping_size: int,
    ) -> ComfyUIRequestResult:
        """通过 InvSR 独立扩散工作流处理单张 RGB 图片。"""
        input_filename = os.path.join(tempfile.gettempdir(), "ai_draw_invsr_input.png")
        try:
            raw_image = await asyncio.to_thread(base64.b64decode, image_b64)
            async with aiofiles.open(input_filename, "wb") as file:
                await file.write(raw_image)
            image_metadata = await self._upload_overwrite_image(input_filename, "invsr_input.png")
            img_path = (
                f"{image_metadata['subfolder']}/{image_metadata['name']}"
                if image_metadata.get('subfolder')
                else image_metadata['name']
            )
            workflow.set_node_param("main_image", "image", img_path)
            workflow.set_node_param("invsr_loader", "sd_model", sd_model)
            workflow.set_node_param("invsr_loader", "invsr_model", invsr_model)
            workflow.set_node_param("invsr_loader", "dtype", dtype)
            workflow.set_node_param("invsr_loader", "tiled_vae", True)
            workflow.set_node_param("invsr_sampler", "num_steps", 1)
            workflow.set_node_param("invsr_sampler", "cfg", 1.0)
            workflow.set_node_param("invsr_sampler", "batch_size", 1)
            workflow.set_node_param("invsr_sampler", "chopping_batch_size", 1)
            workflow.set_node_param("invsr_sampler", "chopping_size", chopping_size)
            workflow.set_node_param("invsr_sampler", "color_fix", "wavelet")
            workflow.set_node_param("invsr_sampler", "seed", 123)
            workflow.set_node_param("output_scale", "scale_by", scale / 4)

            prompt_id = await self._queue_and_poll(workflow, timeout=540)
            image_node_id = workflow.get_node_id("保存图像")
            history = await asyncio.to_thread(self.api.get_history, prompt_id)
            results = history[prompt_id]["outputs"][image_node_id]["images"]
            if not results:
                return ComfyUIRequestResult(success=False, data=None, error="InvSR 未获得有效结果")
            first_result = results[0]
            content = await asyncio.to_thread(
                self.api.get_image,
                first_result["filename"],
                first_result["subfolder"],
                first_result["type"],
            )
            return ComfyUIRequestResult(
                success=True,
                data=base64.b64encode(content).decode('utf-8'),
                error="",
            )
        except Exception as e:
            return ComfyUIRequestResult(success=False, data=None, error=str(e))
        finally:
            try:
                os.unlink(input_filename)
            except OSError:
                pass

    async def generate_minimax_h3_ref(self, workflow, prompt_text, seed, images, duration=5, aspect_ratio="auto"):
        if not 2 <= len(images) <= 9 or any(not image for image in images):
            raise ValueError("动作参考需要一张角色图与 1 到 8 张姿势图")
        return await self.generate_minimax_h3(
            workflow, prompt_text, seed, duration=duration, aspect_ratio=aspect_ratio,
            reference_images=images,
        )

    async def generate_minimax_h3(
        self,
        workflow,
        prompt_text: str,
        seed: int,
        start_image_base64=None,
        end_image_base64=None,
        duration: float = 5,
        aspect_ratio: str = "auto",
        reference_images=None,
    ):
        """执行 H3 文生、单关键帧或首尾帧音视频工作流。"""
        temp_paths = []
        try:
            source_sizes = []
            if aspect_ratio == "auto":
                for image_base64 in (reference_images[:1] if reference_images else (start_image_base64, end_image_base64)):
                    if not image_base64:
                        continue
                    with Image.open(BytesIO(base64.b64decode(image_base64))) as image:
                        source_sizes.append(ImageOps.exif_transpose(image).size)
            width, height = get_minimax_h3_resolution(aspect_ratio, source_sizes)
            frame_count = get_minimax_h3_frame_count(duration)

            missing_titles = []
            if reference_images:
                missing_titles.extend(f"h3_reference_{index}" for index in range(len(reference_images) + 1, 10))
            if not start_image_base64:
                missing_titles.append("main_image_start")
            if not end_image_base64:
                missing_titles.append("main_image_end")
            remove_nodes_by_title(workflow, missing_titles)

            async def upload_keyframe(image_base64: str, title: str, filename: str) -> None:
                temp_path = os.path.join(tempfile.gettempdir(), filename)
                temp_paths.append(temp_path)
                raw_image = await asyncio.to_thread(base64.b64decode, image_base64)
                async with aiofiles.open(temp_path, "wb") as file:
                    await file.write(raw_image)
                metadata = await self._upload_overwrite_image(
                    temp_path,
                    filename,
                    upload_type="temp",
                )
                image_path = (
                    f"{metadata['subfolder']}/{metadata['name']}"
                    if metadata.get("subfolder")
                    else metadata["name"]
                )
                if metadata.get("type") and metadata["type"] != "input":
                    image_path = f"{image_path} [{metadata['type']}]"
                self._set_required_node_param(workflow, title, "image", image_path)

            upload_token = uuid.uuid4().hex
            for index, image_base64 in enumerate(reference_images or [], start=1):
                await upload_keyframe(image_base64, f"h3_reference_{index}", f"minimax_h3_{upload_token}_ref_{index}.png")
            if start_image_base64:
                await upload_keyframe(
                    start_image_base64,
                    "main_image_start",
                    f"minimax_h3_{upload_token}_start.png",
                )
            if end_image_base64:
                await upload_keyframe(
                    end_image_base64,
                    "main_image_end",
                    f"minimax_h3_{upload_token}_end.png",
                )

            self._set_required_node_param(workflow, "h3_conditioning", "prompt", prompt_text)
            self._set_required_node_param(workflow, "h3_conditioning", "width", width)
            self._set_required_node_param(workflow, "h3_conditioning", "height", height)
            self._set_required_node_param(workflow, "h3_conditioning", "length", frame_count)
            self._set_required_node_param(workflow, "seed", "noise_seed", seed)

            prompt_id = await self._queue_and_poll(workflow, timeout=3600)
            video_node_id = workflow.get_node_id("保存视频")
            history = await asyncio.to_thread(self.api.get_history, prompt_id)
            node_output = history[prompt_id]["outputs"].get(video_node_id, {})
            results = node_output.get("videos") or node_output.get("gifs") or node_output.get("images") or []
            if not results:
                return ComfyUIRequestResult(success=False, data=None, error="MiniMax H3 未获得有效视频结果")

            first_result = results[0]
            video_bytes = await asyncio.to_thread(
                self.api.get_image,
                first_result["filename"],
                first_result.get("subfolder", ""),
                first_result.get("type", "output"),
            )
            return ComfyUIRequestResult(
                success=True,
                data=base64.b64encode(video_bytes).decode("utf-8"),
                error="",
            )
        except Exception as error:
            return ComfyUIRequestResult(success=False, data=None, error=str(error))
        finally:
            for temp_path in temp_paths:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

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
