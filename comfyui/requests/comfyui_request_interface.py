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

    async def generate_qwen_image_21(
        self, workflow, prompt_text, images, loras, seed, width, height,
        use_original_size, steps, reference_resolution,
    ) -> ComfyUIRequestResult:
        raise NotImplementedError("此 ComfyUI 后端不支持 Qwen-Image-2.1")

    @abstractmethod
    async def get_upscale_models(self) -> list[str]:
        """获取 ComfyUI 可用模型放大权重。"""

    @abstractmethod
    async def get_object_info(self, node_name: str) -> dict:
        """获取 ComfyUI 单个节点能力。"""

    @abstractmethod
    async def interrupt(self, task=None) -> None:
        """中断指定协程提交的 ComfyUI 队列任务。"""

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
    async def generate_minimax_h3(
        self,
        workflow,
        prompt_text: str,
        seed: int,
        start_image_base64=None,
        end_image_base64=None,
        duration: float = 5,
        aspect_ratio: str = "auto",
    ) -> ComfyUIRequestResult:
        """MiniMax H3 文本/可选首尾帧音视频生成请求。"""

    async def generate_minimax_h3_ref(self, workflow, prompt_text, seed, images, duration=5, aspect_ratio="auto") -> ComfyUIRequestResult:
        raise NotImplementedError("此 ComfyUI 后端不支持 H3 动作参考")

    @abstractmethod
    async def get_state(self) -> ComfyUIRequestState:
        """
        获取ComfyUI服务的当前状态，由子类实现
        可以包括：是否可用、状态信息、资源使用情况等
        """
