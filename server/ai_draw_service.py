"""Application composition root and ComfyUI utility facade.

Generation lifecycle, providers, persistence and events live in server.generation.
"""
import asyncio
import base64
from io import BytesIO
from typing import Optional

from PIL import Image
from comfyui.comfyui_service import ComfyUIService
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from utils.ai_prompt import AIPrompt
from utils.config_loader import get_config
from utils.media_processor import merge_upscaled_alpha
from server.generation.coordinator import GenerationCoordinator
from server.generation.engine import GenerationEngine
from server.generation.events import EventPublisher
from server.generation.persistence import SQLAlchemyGenerationRepository
from server.generation.providers import build_provider_registry
from server.generation.storage import ArtifactStorage
from server.generation.tasks import TaskBusyError
from server.generation.workflows import WorkflowCatalog


class AIDrawService:
    def __init__(self):
        config = get_config()
        self.comfyui = ComfyUIService(request=LocalComfyUIRequest())
        self.ai_prompt = AIPrompt()
        self.is_service_available = False
        self._prompt_tasks: dict[int, int] = {}
        self.events = EventPublisher()
        storage = ArtifactStorage(config.paths.upload_dir)
        providers = build_provider_registry(self.comfyui)
        self.catalog = WorkflowCatalog(
            config.workflow_defaults.workflow_metadata, providers,
        )
        self.generation = GenerationCoordinator(
            GenerationEngine(self.catalog, storage),
            SQLAlchemyGenerationRepository(), self.events,
        )
        self._current_workflow = config.workflow_defaults.current_workflow_type

    async def start_service(self):
        """启动 ComfyUI 服务（如果配置了路径和 Python 解释器）"""
        try:
            config = get_config()
            comfyui_path = config.comfyui.local.path
            python_exec = config.comfyui.local.python_executable
            
            # 如果未配置 ComfyUI 路径或 Python 解释器，跳过自动启动
            if not comfyui_path or not python_exec:
                print("[AIDrawService] ComfyUI 路径或 Python 解释器未配置，跳过自动启动")
                print("[AIDrawService] 请手动启动 ComfyUI 或在配置文件中设置 comfyui.local.path 和 python_executable")
                # 尝试连接已有服务
                status = await self.check_service_status()
                if status:
                    print("[AIDrawService] 检测到外部 ComfyUI 服务正在运行")
                    self.is_service_available = True
                    self.events.public('is_service_available', True)
                return
            
            # 配置完整时启动服务
            self.comfyui.start_connect()
            self.is_service_available = True
            self.events.public('is_service_available', True)
        except Exception as e:
            print(f"[AIDrawService] 启动服务失败: {e}")
            self.is_service_available = False
            self.events.public('is_service_available', False)
    
    def stop_service(self):
        """停止 ComfyUI 服务"""
        try:
            self.comfyui.close_connect()
            self.is_service_available = False
            self.events.public('is_service_available', False)
        except Exception as e:
            print(f"[AIDrawService] 停止服务失败: {e}")
    
    async def check_service_status(self) -> bool:
        """检查 ComfyUI 服务状态"""
        try:
            state = await self.comfyui.get_state()
            self.is_service_available = state.available
            self.events.public('is_service_available', state.available)
            return state.available
        except Exception as e:
            print(f"[AIDrawService] 检查服务状态失败: {e}")
            self.is_service_available = False
            self.events.public('is_service_available', False)
            return False
    
    async def generate_prompt(
        self,
        description: str,
        workflow_id: Optional[str] = None,
        user_id: Optional[int] = None,
        preset_prompt: str = "",
    ) -> str:
        """生成 Prompt；所选预设只作参考，不参与扩写"""
        if user_id is None:
            raise ValueError("Prompt generation requires an authenticated user")
        self._prompt_tasks[user_id] = self._prompt_tasks.get(user_id, 0) + 1
        try:
            self.events.user(user_id, 'is_generating_prompt', True)
            self.events.user(user_id, 'prompt_generation_progress', '正在生成 Prompt...')

            # 获取工作流专属模板（无则回退到全局模板）
            workflow_template = None
            if workflow_id:
                config = get_config()
                if config.workflow_defaults:
                    workflow_template = config.workflow_defaults.get_workflow_prompt_template(workflow_id)

            prompt = await asyncio.to_thread(self.ai_prompt.generate, description, workflow_template, preset_prompt)
            
            self.events.user(user_id, 'prompt_generation_progress', 'Prompt 生成完成')
            return prompt
            
        except Exception as e:
            error_msg = f"Prompt 生成失败: {str(e)}"
            self.events.user(user_id, 'prompt_generation_progress', error_msg)
            raise
        finally:
            remaining = self._prompt_tasks[user_id] - 1
            if remaining:
                self._prompt_tasks[user_id] = remaining
            else:
                self._prompt_tasks.pop(user_id, None)
            self.events.user(user_id, 'is_generating_prompt', remaining > 0)

    async def get_upscale_models(self) -> list[str]:
        """查询 ComfyUI 当前可用的图片放大模型。"""
        return await self.comfyui.get_upscale_models()

    async def analyze_motion_prompt(self, character, poses, description, signature, user_id: int, mode: str = "pose") -> dict:
        from utils.motion_prompt import analyze_motion_images
        if user_id is None:
            raise ValueError("Motion analysis requires an authenticated user")
        self._prompt_tasks[user_id] = self._prompt_tasks.get(user_id, 0) + 1
        self.events.user(user_id, 'is_generating_prompt', True)
        self.events.user(user_id, 'prompt_generation_progress', '正在分析动作参考图...')
        try:
            return await asyncio.to_thread(analyze_motion_images, character, poses, description, signature, mode)
        finally:
            remaining = self._prompt_tasks[user_id] - 1
            if remaining:
                self._prompt_tasks[user_id] = remaining
            else:
                self._prompt_tasks.pop(user_id, None)
            self.events.user(user_id, 'is_generating_prompt', remaining > 0)

    async def get_comfyui_object_info(self, node_name: str) -> dict:
        """查询远端 ComfyUI 节点能力。"""
        return await self.comfyui.get_object_info(node_name)

    async def upscale_image(self, image: Image.Image, model_name: str, scale: int, native_scale: int) -> Image.Image:
        """AI 放大 RGB 内容，并按源图片透明通道生成精确目标尺寸。"""
        def encode_source() -> str:
            rgb_buffer = BytesIO()
            image.convert('RGB').save(rgb_buffer, format='PNG')
            return base64.b64encode(rgb_buffer.getvalue()).decode('utf-8')

        source_b64 = await asyncio.to_thread(encode_source)
        result_b64 = await self.comfyui.upscale_image(source_b64, model_name, scale, native_scale)
        target_size = (image.width * scale, image.height * scale)

        def decode_result() -> Image.Image:
            result = Image.open(BytesIO(base64.b64decode(result_b64)))
            return merge_upscaled_alpha(image, result, target_size)

        return await asyncio.to_thread(decode_result)

    async def upscale_image_invsr(
        self,
        image: Image.Image,
        scale: int,
        sd_model: str,
        invsr_model: str,
        dtype: str,
        chopping_size: int,
    ) -> Image.Image:
        """使用 InvSR 生成式扩散工作流放大，并恢复源 Alpha。"""
        def encode_source() -> str:
            rgb_buffer = BytesIO()
            image.convert('RGB').save(rgb_buffer, format='PNG')
            return base64.b64encode(rgb_buffer.getvalue()).decode('utf-8')

        source_b64 = await asyncio.to_thread(encode_source)
        result_b64 = await self.comfyui.upscale_image_invsr(
            source_b64,
            scale,
            sd_model,
            invsr_model,
            dtype,
            chopping_size,
        )
        target_size = (image.width * scale, image.height * scale)

        def decode_result() -> Image.Image:
            result = Image.open(BytesIO(base64.b64decode(result_b64)))
            return merge_upscaled_alpha(image, result, target_size)

        return await asyncio.to_thread(decode_result)
    

    def initial_state(self, user_id: int) -> dict:
        return {
            **self.generation.snapshot(user_id),
            "is_generating_prompt": self._prompt_tasks.get(user_id, 0) > 0,
            "is_service_available": self.is_service_available,
        }

    def switch_workflow(self, workflow_type: str) -> None:
        if self.generation.tasks.active is not None:
            raise TaskBusyError("已有生成任务正在运行，无法切换服务工作流")
        registration = self.catalog.registration(workflow_type)
        if registration.prepare:
            registration.prepare(workflow_type)
        self._current_workflow = workflow_type
        self.events.public("workflow_type", workflow_type)

    def get_current_workflow(self) -> str:
        return self._current_workflow


_service_instance: Optional[AIDrawService] = None


def get_ai_draw_service() -> AIDrawService:
    global _service_instance
    if _service_instance is None:
        _service_instance = AIDrawService()
    return _service_instance
