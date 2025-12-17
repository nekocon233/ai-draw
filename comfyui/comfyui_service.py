import os
import random
import tempfile

from comfy_api_simplified import ComfyWorkflowWrapper

from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from utils.image_processor import ImageProcessor
from utils.thread_runner import ThreadRunner
from utils.config_loader import get_config


class ComfyUIService:
    """
    ComfyUI服务类，封装了ComfyUI的工作流和请求处理逻辑。
    """

    def __init__(self, request):

        self.request = request
        self.image_processor = ImageProcessor()

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

    async def generate_with_image_and_mask(self, finish_callback, image_base64, mask_base64, prompt_text, denoise_value,
                                           lora_prompt, seed=None):
        """
        image_base64: 原始图片base64
        mask_base64: mask图片base64
        prompt_text: 文本提示
        denoise_value: 去噪强度
        lora_prompt: lora提示词
        seed: 随机种子
        finish_callback: 推理完成后回调，参数为生成的base64图片（失败为None）
        """
        if seed is None:
            seed = random.randrange(0, 0xffffffffffffffff)

        img, orig_size = self.image_processor.convert_to_base64(image_base64)
        image_b64, valid_region = self.image_processor.prepare_image_base64(img)

        # 新增mask处理
        mask_img, _ = self.image_processor.convert_to_base64(mask_base64)
        mask_b64, _ = self.image_processor.prepare_image_base64(mask_img)

        # 请求ComfyUI服务生成图像（异步），传递mask_b64和lora_prompt
        result = await self.request.generate_with_image_and_mask(self.workflow, image_b64, mask_b64, prompt_text,
                                                                 denoise_value, lora_prompt, seed)
        if result.is_success:
            print(f"[ComfyUIService] 生成成功")
            base64_content = self.image_processor.resize(result.data, target_size=orig_size, crop_box=valid_region)
            finish_callback(base64_content)
        else:
            print(f"[ComfyUIService] 生成失败: {result.error}")

    async def get_state(self) -> ComfyUIRequestState:
        """
        获取当前ComfyUI服务的状态
        """

        return await self.request.get_state()
