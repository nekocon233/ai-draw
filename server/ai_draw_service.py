"""
AI 绘画服务核心模块

直接管理 ComfyUI 调用和状态
"""
import asyncio
from typing import Optional, Dict, Any
from comfyui.comfyui_service import ComfyUIService
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from utils.ai_prompt import AIPrompt
from utils.config_loader import get_config


class AIDrawService:
    """AI 绘画服务"""
    
    def __init__(self):
        # ComfyUI 服务
        self.comfyui = ComfyUIService(request=LocalComfyUIRequest())
        
        # AI Prompt 生成器
        self.ai_prompt = AIPrompt()
        
        # 当前状态
        self.is_generating = False
        self.is_generating_prompt = False
        self.is_service_available = False
        
        # 预览图片列表
        self.preview_images = []
        
        # 状态变化回调
        self.on_state_change = None
    
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
                    self._notify_state_change('is_service_available', True)
                return
            
            # 配置完整时启动服务
            self.comfyui.start_connect()
            self.is_service_available = True
            self._notify_state_change('is_service_available', True)
        except Exception as e:
            print(f"[AIDrawService] 启动服务失败: {e}")
            self.is_service_available = False
            self._notify_state_change('is_service_available', False)
    
    def stop_service(self):
        """停止 ComfyUI 服务"""
        try:
            self.comfyui.close_connect()
            self.is_service_available = False
            self._notify_state_change('is_service_available', False)
        except Exception as e:
            print(f"[AIDrawService] 停止服务失败: {e}")
    
    async def check_service_status(self) -> bool:
        """检查 ComfyUI 服务状态"""
        try:
            state = await self.comfyui.get_state()
            self.is_service_available = state.available
            self._notify_state_change('is_service_available', state.available)
            return state.available
        except Exception as e:
            print(f"[AIDrawService] 检查服务状态失败: {e}")
            self.is_service_available = False
            self._notify_state_change('is_service_available', False)
            return False
    
    async def generate_prompt(self, description: str) -> str:
        """生成 Prompt"""
        try:
            self.is_generating_prompt = True
            self._notify_state_change('is_generating_prompt', True)
            self._notify_state_change('prompt_generation_progress', '正在生成 Prompt...')
            
            prompt = await asyncio.to_thread(self.ai_prompt.generate, description)
            
            self._notify_state_change('prompt_generation_progress', 'Prompt 生成完成')
            return prompt
            
        except Exception as e:
            error_msg = f"Prompt 生成失败: {str(e)}"
            self._notify_state_change('prompt_generation_progress', error_msg)
            raise
        finally:
            self.is_generating_prompt = False
            self._notify_state_change('is_generating_prompt', False)
    
    async def generate_image(
        self,
        prompt: str,
        workflow: str = "t2i",
        strength: float = 0.5,
        lora_prompt: str = "",
        count: int = 1,
        reference_image: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None
    ) -> list:
        """生成图像 - 使用用户选择的工作流"""
        try:
            self.is_generating = True
            self._notify_state_change('is_generating', True)
            self._notify_state_change('generation_progress', '正在生成图像...')
            
            # 使用用户选择的工作流
            workflow_type = workflow
            print(f"[AIDrawService] 使用工作流: {workflow_type}")
            
            # 切换工作流
            if workflow_type != self.comfyui.get_current_workflow_type():
                self.comfyui.switch_workflow(workflow_type)
            
            # 处理参考图（如果有）
            image_base64 = None
            if reference_image:
                # 去除 data URL 前缀（如果有）
                if reference_image.startswith('data:image'):
                    # 格式: data:image/png;base64,xxxxx
                    image_base64 = reference_image.split(',', 1)[1]
                else:
                    image_base64 = reference_image
            
            # 生成多张图片
            images = []
            for i in range(count):
                seed = None  # 让方法自动生成
                
                # 存储结果
                result_images = []
                
                # 定义回调函数
                def finish_callback(base64_content):
                    # 添加 data URL 前缀，让前端可以直接显示
                    if base64_content and not base64_content.startswith('data:'):
                        base64_content = f"data:image/png;base64,{base64_content}"
                    result_images.append(base64_content)
                    
                    # 实时推送单张图片
                    self._notify_state_change('image_generated', {
                        'image': base64_content,
                        'index': i,
                        'total': count
                    })
                
                # 根据工作流类型调用不同的方法
                # 从配置中获取工作流元数据判断是否需要参考图
                from utils.config_loader import get_config
                config = get_config()
                workflow_meta = config.workflow_defaults.workflow_metadata.get(workflow_type, {})
                requires_image = workflow_meta.get('requires_image', False)
                
                if requires_image:
                    # 需要参考图的工作流
                    if not image_base64:
                        workflow_label = workflow_meta.get('label', workflow_type)
                        raise ValueError(f"工作流 '{workflow_label}' 需要提供参考图")
                    
                    await self.comfyui.generate_i2i(
                        finish_callback=finish_callback,
                        image_base64=image_base64,
                        prompt_text=prompt,
                        denoise_value=strength,
                        lora_prompt=lora_prompt or "",
                        seed=seed,
                        width=width,
                        height=height
                    )
                else:
                    # 文生图工作流
                    await self.comfyui.generate_t2i(
                        finish_callback=finish_callback,
                        prompt_text=prompt,
                        denoise_value=strength,
                        lora_prompt=lora_prompt or "",
                        seed=seed
                    )
                
                if result_images and result_images[0] is not None:
                    images.extend(result_images)
                    print(f"[AIDrawService] 第 {i+1}/{count} 张生成成功")
                else:
                    error_msg = f"第 {i+1}/{count} 张生成失败：未收到有效图像数据"
                    print(f"[AIDrawService] {error_msg}")
                    raise Exception(error_msg)
            
            # 添加到预览列表
            if images:
                for img in images:
                    preview_data = {
                        'id': len(self.preview_images) + 1,
                        'image': img,
                        'workflow': workflow_type
                    }
                    self.preview_images.append(preview_data)
                    self._notify_state_change('preview_update', {
                        'action': 'add',
                        'data': preview_data
                    })
            
            self._notify_state_change('generation_progress', '图像生成完成')
            return images
            
        except Exception as e:
            error_msg = f"图像生成失败: {str(e)}"
            self._notify_state_change('generation_progress', error_msg)
            raise
        finally:
            self.is_generating = False
            self._notify_state_change('is_generating', False)
    
    def clear_previews(self):
        """清空预览图片"""
        self.preview_images = []
        self._notify_state_change('preview_update', {'action': 'clear'})
    
    def switch_workflow(self, workflow_type: str):
        """切换工作流"""
        self.comfyui.switch_workflow(workflow_type)
        self._notify_state_change('workflow_type', workflow_type)
    
    def get_available_workflows(self) -> list[str]:
        """获取可用的工作流列表"""
        return list(self.comfyui.workflow_configs.keys())
    
    def get_current_workflow(self) -> str:
        """获取当前工作流类型"""
        return self.comfyui.get_current_workflow_type()
    
    def _notify_state_change(self, field: str, value: Any):
        """通知状态变化"""
        if self.on_state_change:
            try:
                self.on_state_change(field, value)
            except Exception as e:
                print(f"[AIDrawService] 状态变化回调失败: {e}")


# 全局服务实例
_service_instance: Optional[AIDrawService] = None


def get_ai_draw_service() -> AIDrawService:
    """获取 AI 绘画服务单例"""
    global _service_instance
    if _service_instance is None:
        _service_instance = AIDrawService()
    return _service_instance
