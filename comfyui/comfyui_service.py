import asyncio
import copy
import json
import os
import random
import tempfile
from typing import Optional

from comfy_api_simplified import ComfyWorkflowWrapper

from comfyui.structures.comfyui_request_state import ComfyUIRequestState
from comfyui.binding_engine import BindingEngine
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
        self._workflow_template_cache = {}
        self._workflow_template_lock = None

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

    def _get_workflow_path(self, workflow_type: str) -> str:
        if workflow_type in self.workflow_configs:
            config_file = self.workflow_configs[workflow_type]
            workflow_path = os.path.join(self.config_dir, config_file)
            if not os.path.exists(workflow_path):
                raise FileNotFoundError(f"[ComfyUIService] 工作流配置文件不存在: {workflow_path}")
            return workflow_path

        if workflow_type.lower().endswith(".json"):
            candidate = os.path.join(self.config_dir, workflow_type)
            if os.path.exists(candidate):
                return candidate

        candidate = os.path.join(self.config_dir, f"{workflow_type}.json")
        if os.path.exists(candidate):
            return candidate

        raise ValueError(
            f"[ComfyUIService] 未找到工作流: {workflow_type}。"
            f" 搜索目录: {self.config_dir}。"
            f" 尝试文件: {os.path.join(self.config_dir, workflow_type)}, {os.path.join(self.config_dir, f'{workflow_type}.json')}。"
            f" 已配置 key: {list(self.workflow_configs.keys())}"
        )

    def _read_workflow_file_text(self, workflow_path: str) -> str:
        encodings_to_try = ['utf-8', 'gbk']
        for encoding in encodings_to_try:
            try:
                with open(workflow_path, 'r', encoding=encoding) as file:
                    content = file.read()
                print(f"[ComfyUIService] 成功使用 {encoding} 编码读取工作流文件")
                return content
            except UnicodeDecodeError:
                continue
        raise Exception("无法读取工作流文件")

    def _get_workflow_template_lock(self) -> asyncio.Lock:
        if self._workflow_template_lock is None:
            self._workflow_template_lock = asyncio.Lock()
        return self._workflow_template_lock

    def _select_temp_dir(self) -> Optional[str]:
        configured = os.environ.get("WORKFLOW_TMP_DIR")
        if configured and os.path.isdir(configured):
            return configured
        if os.path.isdir("/dev/shm"):
            return "/dev/shm"
        return None

    def _try_load_workflow_template_from_db(self, workflow_type: str) -> Optional[tuple[dict, str]]:
        try:
            from server.database import SessionLocal
            from server.models import WorkflowDefinition

            db = SessionLocal()
            try:
                row = (
                    db.query(WorkflowDefinition)
                    .filter(WorkflowDefinition.key == workflow_type)
                    .first()
                )
                if not row or not row.workflow_json:
                    return None

                template_dict = json.loads(row.workflow_json)
                sig = row.content_hash or str(row.updated_at.timestamp() if row.updated_at else "")
                return template_dict, f"db:{sig}"
            finally:
                db.close()
        except Exception:
            return None

    def _try_load_workflow_runtime_config_from_db(self, workflow_type: str) -> Optional[tuple[list[dict], str]]:
        try:
            from server.database import SessionLocal
            from server.models import WorkflowDefinition

            db = SessionLocal()
            try:
                row = (
                    db.query(WorkflowDefinition)
                    .filter(WorkflowDefinition.key == workflow_type)
                    .first()
                )
                if not row:
                    return None

                output_node_title = row.output_node_title or "保存图像"
                try:
                    if row.workflow_json:
                        workflow_dict = json.loads(row.workflow_json)
                        if isinstance(workflow_dict, dict):
                            titles: list[str] = []
                            for node in workflow_dict.values():
                                if not isinstance(node, dict):
                                    continue
                                if node.get("class_type") != "SaveImage":
                                    continue
                                meta = node.get("_meta") or {}
                                title = meta.get("title")
                                if title:
                                    titles.append(str(title))
                            if titles:
                                if output_node_title == "保存图像" and titles[0] != output_node_title:
                                    output_node_title = titles[0]
                                elif output_node_title not in titles:
                                    output_node_title = titles[0]
                except Exception:
                    pass
                bindings = []
                if row.bindings_json:
                    try:
                        parsed = json.loads(row.bindings_json)
                        if isinstance(parsed, list):
                            bindings = parsed
                    except Exception:
                        bindings = []

                return bindings, output_node_title
            finally:
                db.close()
        except Exception:
            return None

    def get_runtime_config(self, workflow_type: str, requires_image: bool) -> tuple[list[dict], str, Optional[dict]]:
        runtime = self._try_load_workflow_runtime_config_from_db(workflow_type)
        if runtime:
            bindings, output_node_title = runtime
        else:
            bindings, output_node_title = [], "保存图像"

        if not bindings:
            bindings = [
                {"value_from": "prompt", "node_title": "positive_prompt", "input_name": "positive", "value_type": "str"},
                {"value_from": "lora_prompt", "node_title": "lora_prompt", "input_name": "positive", "value_type": "str"},
                {"value_from": "seed", "node_title": "seed", "input_name": "value", "value_type": "int"},
            ]
            if requires_image:
                bindings.extend([
                    {"value_from": "strength", "node_title": "denoise", "input_name": "value", "value_type": "float"},
                    {"value_from": "width", "node_title": "width", "input_name": "value", "value_type": "int"},
                    {"value_from": "height", "node_title": "height", "input_name": "value", "value_type": "int"},
                    {"value_from": "uploaded_image_path", "node_title": "main_image", "input_name": "image", "value_type": "str"},
                ])

        image_binding = BindingEngine.find_binding(bindings, "uploaded_image_path")
        return bindings, output_node_title, image_binding

    async def get_workflow_template_dict(self, workflow_type: str) -> dict:
        db_template = self._try_load_workflow_template_from_db(workflow_type)
        if db_template:
            template_dict, sig = db_template
            if isinstance(template_dict, dict) and isinstance(template_dict.get("nodes"), list):
                raise ValueError("不支持该工作流 JSON 格式，请导出 ComfyUI 的 API 格式（workflow_api.json）")
            cached = self._workflow_template_cache.get(workflow_type)
            if cached and cached.get("sig") == sig:
                return cached["template_dict"]

            async with self._get_workflow_template_lock():
                cached = self._workflow_template_cache.get(workflow_type)
                if cached and cached.get("sig") == sig:
                    return cached["template_dict"]

                self._workflow_template_cache[workflow_type] = {
                    "sig": sig,
                    "template_dict": template_dict,
                }
                return template_dict

        workflow_path = self._get_workflow_path(workflow_type)
        mtime = os.path.getmtime(workflow_path)
        sig = f"file:{mtime}"

        cached = self._workflow_template_cache.get(workflow_type)
        if cached and cached.get("sig") == sig:
            return cached["template_dict"]

        async with self._get_workflow_template_lock():
            cached = self._workflow_template_cache.get(workflow_type)
            if cached and cached.get("sig") == sig:
                return cached["template_dict"]

            content = self._read_workflow_file_text(workflow_path)
            template_dict = json.loads(content)
            if isinstance(template_dict, dict) and isinstance(template_dict.get("nodes"), list):
                raise ValueError("不支持该工作流 JSON 格式，请导出 ComfyUI 的 API 格式（workflow_api.json）")
            self._workflow_template_cache[workflow_type] = {
                "sig": sig,
                "template_dict": template_dict,
            }
            return template_dict

    async def create_workflow_snapshot(self, workflow_type: str) -> tuple[ComfyWorkflowWrapper, str]:
        template_dict = await self.get_workflow_template_dict(workflow_type)
        snapshot_dict = copy.deepcopy(template_dict)
        snapshot_json = json.dumps(snapshot_dict, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

        temp_dir = self._select_temp_dir()
        temp_file = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".json",
            delete=False,
            dir=temp_dir,
        )
        try:
            temp_file.write(snapshot_json)
            temp_file.flush()
            temp_path = temp_file.name
        finally:
            temp_file.close()

        workflow = ComfyWorkflowWrapper(temp_path)
        return workflow, temp_path

    def cleanup_snapshot_file(self, temp_path: str) -> None:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception as e:
                print(f"[ComfyUIService] 清理临时文件失败: {e}")

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

    def _has_noise_seed(self, workflow_obj) -> bool:
        try:
            for node in workflow_obj.values():
                if not isinstance(node, dict):
                    continue
                inputs = node.get("inputs") or {}
                if isinstance(inputs, dict) and "noise_seed" in inputs:
                    return True
        except Exception:
            return False
        return False

    async def generate_t2i(self, finish_callback, prompt_text, denoise_value, lora_prompt, seed=None):
        """
        文生图（Text-to-Image）
        prompt_text: 文本提示
        denoise_value: 去噪强度
        lora_prompt: lora提示词
        seed: 随机种子
        finish_callback: 推理完成后回调，参数为生成的base64图片（失败为None）
        """
        if seed is None:
            # 限制为有符号 64 位整数范围，避免 ComfyUI 返回 400 错误
            seed = random.randrange(0, 2**63)

        workflow = self.workflow
        bindings, output_node_title, image_binding = self.get_runtime_config(self.current_workflow_type, False)
        applied = BindingEngine.apply(workflow, bindings, {
            "prompt": prompt_text,
            "lora_prompt": lora_prompt or "",
            "seed": seed,
            "strength": denoise_value,
        })
        if applied.get("prompt", 0) == 0:
            raise ValueError("工作流绑定未命中：prompt（提示词未写入工作流）")
        if self._has_noise_seed(workflow) and applied.get("seed", 0) == 0:
            raise ValueError("工作流绑定未命中：seed（随机种子未写入工作流）")
        result = await self.request.generate_t2i(workflow, prompt_text, denoise_value, lora_prompt, seed, output_node_title=output_node_title)
        if result.is_success:
            print(f"[ComfyUIService] T2I生成成功")
            finish_callback(result.data)
        else:
            print(f"[ComfyUIService] T2I生成失败: {result.error}")

    async def generate_i2i(self, finish_callback, image_base64, prompt_text, denoise_value, lora_prompt, seed=None, width=None, height=None):
        """
        图生图（Image-to-Image）
        image_base64: 原始图片base64
        prompt_text: 文本提示
        denoise_value: 去噪强度
        lora_prompt: lora提示词
        seed: 随机种子
        width: 图像宽度（可选，部分工作流支持）
        height: 图像高度（可选，部分工作流支持）
        finish_callback: 推理完成后回调，参数为生成的base64图片（失败为None）
        """
        if seed is None:
            # 限制为有符号 64 位整数范围，避免 ComfyUI 返回 400 错误
            seed = random.randrange(0, 2**63)

        img, orig_size = self.image_processor.convert_to_base64(image_base64)
        image_b64, valid_region = self.image_processor.prepare_image_base64(img)

        workflow = self.workflow
        bindings, output_node_title, image_binding = self.get_runtime_config(self.current_workflow_type, True)
        applied = BindingEngine.apply(workflow, [b for b in bindings if b.get("value_from") != "uploaded_image_path"], {
            "prompt": prompt_text,
            "lora_prompt": lora_prompt or "",
            "seed": seed,
            "strength": denoise_value,
            "width": width,
            "height": height,
        })
        if applied.get("prompt", 0) == 0:
            raise ValueError("工作流绑定未命中：prompt（提示词未写入工作流）")
        if self._has_noise_seed(workflow) and applied.get("seed", 0) == 0:
            raise ValueError("工作流绑定未命中：seed（随机种子未写入工作流）")
        result = await self.request.generate_i2i(workflow, image_b64, prompt_text, denoise_value, lora_prompt, seed, width, height, output_node_title=output_node_title, image_binding=image_binding)
        if result.is_success:
            print(f"[ComfyUIService] I2I生成成功")
            finish_callback(result.data)
        else:
            print(f"[ComfyUIService] I2I生成失败: {result.error}")

    async def generate_t2i_snapshot(self, workflow: ComfyWorkflowWrapper, finish_callback, prompt_text, denoise_value, lora_prompt, seed=None, bindings: Optional[list[dict]] = None, output_node_title: str = "保存图像"):
        if seed is None:
            seed = random.randrange(0, 2**63)
        if bindings:
            applied = BindingEngine.apply(workflow, bindings, {
                "prompt": prompt_text,
                "lora_prompt": lora_prompt or "",
                "seed": seed,
                "strength": denoise_value,
            })
            if applied.get("prompt", 0) == 0:
                raise ValueError("工作流绑定未命中：prompt（提示词未写入工作流）")
            if self._has_noise_seed(workflow) and applied.get("seed", 0) == 0:
                raise ValueError("工作流绑定未命中：seed（随机种子未写入工作流）")
        result = await self.request.generate_t2i(workflow, prompt_text, denoise_value, lora_prompt, seed, output_node_title=output_node_title)
        if result.is_success:
            print(f"[ComfyUIService] T2I生成成功")
            finish_callback(result.data)
        else:
            print(f"[ComfyUIService] T2I生成失败: {result.error}")
            raise ValueError(result.error or "ComfyUI 执行失败")

    async def generate_i2i_snapshot(self, workflow: ComfyWorkflowWrapper, finish_callback, image_base64, prompt_text, denoise_value, lora_prompt, seed=None, width=None, height=None, bindings: Optional[list[dict]] = None, output_node_title: str = "保存图像", image_binding: Optional[dict] = None):
        if seed is None:
            seed = random.randrange(0, 2**63)

        img, orig_size = self.image_processor.convert_to_base64(image_base64)
        image_b64, valid_region = self.image_processor.prepare_image_base64(img)

        if bindings:
            applied = BindingEngine.apply(workflow, [b for b in bindings if b.get("value_from") != "uploaded_image_path"], {
                "prompt": prompt_text,
                "lora_prompt": lora_prompt or "",
                "seed": seed,
                "strength": denoise_value,
                "width": width,
                "height": height,
            })
            if applied.get("prompt", 0) == 0:
                raise ValueError("工作流绑定未命中：prompt（提示词未写入工作流）")
            if self._has_noise_seed(workflow) and applied.get("seed", 0) == 0:
                raise ValueError("工作流绑定未命中：seed（随机种子未写入工作流）")
        result = await self.request.generate_i2i(workflow, image_b64, prompt_text, denoise_value, lora_prompt, seed, width, height, output_node_title=output_node_title, image_binding=image_binding)
        if result.is_success:
            print(f"[ComfyUIService] I2I生成成功")
            finish_callback(result.data)
        else:
            print(f"[ComfyUIService] I2I生成失败: {result.error}")
            raise ValueError(result.error or "ComfyUI 执行失败")

    async def get_state(self) -> ComfyUIRequestState:
        """
        获取当前ComfyUI服务的状态
        """

        return await self.request.get_state()
