from abc import abstractmethod, ABCMeta

from comfyui.structures.comfyui_request_result import ComfyUIRequestResult
from comfyui.structures.comfyui_request_state import ComfyUIRequestState


class ComfyUIRequestInterface(metaclass=ABCMeta):
    """
    ComfyUI请求的抽象接口
    """

    @abstractmethod
    async def start_connect(self):
        """
        启动连接，子类实现
        例如：建立WebSocket连接或HTTP连接
        """

    @abstractmethod
    def close_connect(self):
        """
        关闭连接，子类实现
        例如：关闭WebSocket连接或HTTP连接
        """

    @abstractmethod
    async def generate_t2i(self, workflow, prompt_text, denoise_value, lora_prompt, seed) -> ComfyUIRequestResult:
        """
        文生图（Text-to-Image）推理请求，由子类实现
        """

    @abstractmethod
    async def generate_i2i(self, workflow, image_b64, prompt_text, denoise_value, lora_prompt, seed, width=None, height=None, image_base64_2=None, image_base64_3=None) -> ComfyUIRequestResult:
        """
        图生图（Image-to-Image）推理请求，由子类实现
        width: 图像宽度（可选）
        height: 图像高度（可选）
        image_b64_2: 第 2 张参考图 base64（可选）
        image_b64_3: 第 3 张参考图 base64（可选）
        """

    @abstractmethod
    async def get_upscale_models(self) -> list[str]:
        """获取 ComfyUI 可用模型放大权重。"""

    @abstractmethod
    async def get_object_info(self, node_name: str) -> dict:
        """获取 ComfyUI 单个节点能力。"""

    @abstractmethod
    async def interrupt(self) -> None:
        """中断当前 ComfyUI 队列任务。"""

    @abstractmethod
    async def upscale_image(self, workflow, image_b64: str, model_name: str, scale: int, native_scale: int) -> ComfyUIRequestResult:
        """执行通用模型放大工作流。"""

    @abstractmethod
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
        """执行 InvSR 扩散放大工作流。"""

    @abstractmethod
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
    ) -> ComfyUIRequestResult:
        """
        首尾帧生视频（First-Last-Frame to Video）推理请求，由子类实现
        """

    @abstractmethod
    async def generate_i2v(
        self,
        workflow,
        image_base64: str,
        prompt_text: str,
        seed: int,
        frame_count=None,
        frame_rate=None,
    ) -> ComfyUIRequestResult:
        """
        图生视频（Image-to-Video）推理请求，由子类实现
        """

    @abstractmethod
    async def get_state(self) -> ComfyUIRequestState:
        """
        获取ComfyUI服务的当前状态，由子类实现
        可以包括：是否可用、状态信息、资源使用情况等
        """
