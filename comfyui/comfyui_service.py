import os
import random
import tempfile

from comfy_api_simplified import ComfyWorkflowWrapper

from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from utils.thread_runner import ThreadRunner
from utils.config_loader import get_config


class ComfyUIService:
    """
    ComfyUI服务类，封装了ComfyUI的工作流和请求处理逻辑。
    """

    def __init__(self, request):

        self.request = request

        self.workflow = None
        self.temp_workflow_file = None  # 存储临时工作流文件路径

        # 从配置加载工作流配置
        config = get_config()
        workflow_defaults = config.workflow_defaults
        
        # 工作流配置文件映射 - 直接从配置读取
        self.workflow_configs = workflow_defaults.workflow_files

        # 当前工作流类型 - 从配置读取
        self.current_workflow_type = workflow_defaults.current_workflow_type

        # 获取配置文件路径 - 从配置读取
        self.config_dir = config.paths.workflows

        # 初始化默认工作流
        self.load_workflow(self.current_workflow_type)

    def load_workflow(self, workflow_type):
        """
        加载指定类型的工作流配置

        参数:
            workflow_type (str): 工作流类型
        """
        if workflow_type not in self.workflow_configs:
            raise ValueError(f"[ComfyUIService] 未知的工作流类型: {workflow_type}，可用类型: {list(self.workflow_configs.keys())}")

        config_file = self.workflow_configs[workflow_type]
        workflow_path = os.path.join(self.config_dir, config_file)

        # 检查配置文件是否存在
        if not os.path.exists(workflow_path):
            raise FileNotFoundError(f"[ComfyUIService] 工作流配置文件不存在: {workflow_path}")

        try:
            # 清理之前的临时文件
            self._cleanup_temp_file()

            # 读取原始工作流文件内容
            content = None
            encodings_to_try = ['utf-8', 'gbk']

            for encoding in encodings_to_try:
                try:
                    with open(workflow_path, 'r', encoding=encoding) as file:
                        content = file.read()
                    print(f"[ComfyUIService] 成功使用 {encoding} 编码读取工作流文件")
                    break
                except UnicodeDecodeError:
                    continue

            if content is None:
                raise Exception("无法读取工作流文件")

            # 创建临时文件并自适应编码
            temp_file_created = False
            encodings_for_temp = ['utf-8', 'gbk']

            for temp_encoding in encodings_for_temp:
                try:
                    # 创建临时文件
                    temp_fd, self.temp_workflow_file = tempfile.mkstemp(suffix='.json', text=True)
                    with os.fdopen(temp_fd, 'w', encoding=temp_encoding) as temp_file:
                        temp_file.write(content)

                    # 测试ComfyWorkflowWrapper是否能读取
                    test_workflow = ComfyWorkflowWrapper(self.temp_workflow_file)
                    self.workflow = test_workflow
                    temp_file_created = True
                    print(f"[ComfyUIService] 使用 {temp_encoding} 编码创建临时文件并成功加载")
                    break

                except Exception:
                    # 清理失败的临时文件
                    if hasattr(self, 'temp_workflow_file') and os.path.exists(self.temp_workflow_file):
                        os.unlink(self.temp_workflow_file)
                    continue

            if not temp_file_created:
                raise Exception("无法创建ComfyWorkflowWrapper能够读取的临时文件")

            self.current_workflow_type = workflow_type
            print(f"[ComfyUIService] 成功加载工作流: {workflow_type} ({config_file})")

        except Exception as e:
            print(f"[ComfyUIService] 加载工作流失败: {e}")
            raise

    def _cleanup_temp_file(self):
        """
        清理临时工作流文件
        """
        if self.temp_workflow_file and os.path.exists(self.temp_workflow_file):
            try:
                os.unlink(self.temp_workflow_file)
                print(f"[ComfyUIService] 清理临时文件: {self.temp_workflow_file}")
            except Exception as e:
                print(f"[ComfyUIService] 清理临时文件失败: {e}")
            finally:
                self.temp_workflow_file = None

    def switch_workflow(self, workflow_type):
        """
        切换工作流类型

        参数:
            workflow_type (str): 要切换到的工作流类型
        """
        if workflow_type != self.current_workflow_type:
            print(f"[ComfyUIService] 切换工作流: {self.current_workflow_type} -> {workflow_type}")
            self.load_workflow(workflow_type)
        else:
            print(f"[ComfyUIService] 工作流已经是: {workflow_type}")

    def _workflow_file(self):
        """返回当前工作流的临时副本；暂停服务时 close_connect 会删除它，此时按当前类型重新加载。"""
        if not self.temp_workflow_file or not os.path.exists(self.temp_workflow_file):
            print(f"[ComfyUIService] 临时工作流文件已清理，重新加载: {self.current_workflow_type}")
            self.load_workflow(self.current_workflow_type)
        return self.temp_workflow_file

    def get_current_workflow_type(self):
        """
        获取当前工作流类型

        返回:
            str: 当前工作流类型
        """
        return self.current_workflow_type

    def start_connect(self):
        """
        在线程中启动连接到ComfyUI服务，避免阻塞主线程。
        增加异常捕获、详细日志和超时机制，便于排查连接问题。
        """
        ThreadRunner.instance().run_thread_async(self.request.start_connect, "[ComfyUIService] ComfyUI服务连接")

    def close_connect(self):
        """
        关闭连接到ComfyUI服务
        """

        print("[ComfyUIService] ComfyUI服务关闭中...")
        self.request.close_connect()
        # 清理临时工作流文件
        self._cleanup_temp_file()
        print("[ComfyUIService] ComfyUI服务连接已关闭。")

    def __del__(self):
        """
        析构函数，确保临时文件被清理
        """
        self._cleanup_temp_file()

    async def generate_qwen_image_21(
        self, finish_callback, prompt_text, images, loras, width=1024, height=1024,
        use_original_size=True, steps=40, reference_resolution=1024, seed=None,
    ):
        workflow = ComfyWorkflowWrapper(self._workflow_file())
        result = await self.request.generate_qwen_image_21(
            workflow, prompt_text, images, loras,
            random.randrange(0, 2**63) if seed is None else seed,
            width, height, use_original_size, steps, reference_resolution,
        )
        if not result.is_success:
            raise RuntimeError(result.error or "Qwen-Image-2.1 生成失败")
        finish_callback(result.data)

    async def get_upscale_models(self) -> list[str]:
        """返回远端 ComfyUI 已安装的放大模型。"""
        return await self.request.get_upscale_models()

    async def get_object_info(self, node_name: str) -> dict:
        """返回远端 ComfyUI 节点定义。"""
        return await self.request.get_object_info(node_name)

    async def interrupt(self, task=None) -> None:
        """中断指定生成协程对应的 ComfyUI 执行。"""
        await self.request.interrupt(task)

    async def upscale_image(self, image_base64: str, model_name: str, scale: int, native_scale: int) -> str:
        """使用独立工作流放大图片，不切换当前生成工作流。"""
        workflow_file = self.workflow_configs.get("image_upscale")
        if not workflow_file:
            raise RuntimeError("未配置图片放大工作流")
        workflow_path = os.path.join(self.config_dir, workflow_file)
        workflow = ComfyWorkflowWrapper(workflow_path)
        result = await self.request.upscale_image(workflow, image_base64, model_name, scale, native_scale)
        if not result.is_success or not result.data:
            raise RuntimeError(result.error or "AI 放大未返回图片")
        return result.data

    async def upscale_image_invsr(
        self,
        image_base64: str,
        scale: int,
        sd_model: str,
        invsr_model: str,
        dtype: str,
        chopping_size: int,
    ) -> str:
        """使用 InvSR 独立扩散工作流放大图片。"""
        workflow_file = self.workflow_configs.get("image_upscale_invsr")
        if not workflow_file:
            raise RuntimeError("未配置 InvSR 放大工作流")
        workflow_path = os.path.join(self.config_dir, workflow_file)
        workflow = ComfyWorkflowWrapper(workflow_path)
        result = await self.request.upscale_image_invsr(
            workflow,
            image_base64,
            scale,
            sd_model,
            invsr_model,
            dtype,
            chopping_size,
        )
        if not result.is_success or not result.data:
            raise RuntimeError(result.error or "InvSR 未返回图片")
        return result.data

    async def generate_minimax_h3(
        self,
        finish_callback,
        prompt_text: str,
        start_image_base64=None,
        end_image_base64=None,
        seed=None,
        duration: float = 5,
        aspect_ratio: str = "auto",
        audio: bool = False,
    ):
        """使用 H3-Base-FL2VA 生成视频；audio 为 True 时保留原生双声道音轨。"""
        if seed is None:
            seed = random.randrange(0, 2**63)

        # 可选关键帧和音轨会删除工作流节点，每次请求必须使用新副本。
        fresh_workflow = ComfyWorkflowWrapper(self._workflow_file())
        result = await self.request.generate_minimax_h3(
            fresh_workflow,
            prompt_text,
            seed,
            start_image_base64=start_image_base64,
            end_image_base64=end_image_base64,
            duration=duration,
            aspect_ratio=aspect_ratio,
            audio=audio,
        )
        if not result.is_success or not result.data:
            raise RuntimeError(result.error or "MiniMax H3 未返回有效视频")
        print(f"[ComfyUIService] MiniMax H3 {'音视频' if audio else '无声视频'}生成成功")
        finish_callback(result.data)

    async def generate_minimax_h3_ref(
        self, finish_callback, prompt_text, images, duration=5, aspect_ratio="auto", seed=None, audio=False,
        canvas_image_index=0,
    ):
        workflow = ComfyWorkflowWrapper(self._workflow_file())
        result = await self.request.generate_minimax_h3_ref(
            workflow, prompt_text, random.randrange(0, 2**63) if seed is None else seed,
            images, duration=duration, aspect_ratio=aspect_ratio, audio=audio,
            canvas_image_index=canvas_image_index,
        )
        if not result.is_success or not result.data:
            raise RuntimeError(result.error or "MiniMax H3 动作参考未返回有效视频")
        finish_callback(result.data)

    async def get_state(self) -> ComfyUIRequestState:
        """
        获取当前ComfyUI服务的状态
        """

        return await self.request.get_state()
