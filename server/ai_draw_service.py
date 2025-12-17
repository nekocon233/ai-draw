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
        strength: float = 0.5,
        lora_prompt: str = "",
        count: int = 1,
        workflow_type: str = "参考",
        reference_image: Optional[str] = None
    ) -> list:
        """生成图像"""
        try:
            self.is_generating = True
            self._notify_state_change('is_generating', True)
            self._notify_state_change('generation_progress', '正在生成图像...')
            
            # 切换工作流
            if workflow_type != self.comfyui.get_current_workflow_type():
                self.comfyui.switch_workflow(workflow_type)
            
            # 准备图片和mask
            import base64
            from PIL import Image
            import io
            
            # 使用参考图或创建默认图
            if reference_image:
                # 去除 data URL 前缀（如果有）
                if reference_image.startswith('data:image'):
                    # 格式: data:image/png;base64,xxxxx
                    image_base64 = reference_image.split(',', 1)[1]
                else:
                    image_base64 = reference_image
                
                # 获取图片尺寸以创建等大的mask
                img_data = base64.b64decode(image_base64)
                img = Image.open(io.BytesIO(img_data))
                width, height = img.size
            else:
                # 如果没有参考图，创建一个512x512的空白图
                width, height = 512, 512
                empty_img = Image.new('RGB', (width, height), (255, 255, 255))
                img_buffer = io.BytesIO()
                empty_img.save(img_buffer, format='PNG')
                image_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
            
            # 创建与图片等大的白色mask
            mask_img = Image.new('RGB', (width, height), (255, 255, 255))
            mask_buffer = io.BytesIO()
            mask_img.save(mask_buffer, format='PNG')
            mask_base64 = base64.b64encode(mask_buffer.getvalue()).decode('utf-8')
            
            # 生成多张图片
            images = []
            for i in range(count):
                seed = None  # 让 generate_with_image_and_mask 自动生成
                
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
                
                # 调用 generate_with_image_and_mask
                await self.comfyui.generate_with_image_and_mask(
                    finish_callback=finish_callback,
                    image_base64=image_base64,
                    mask_base64=mask_base64,
                    prompt_text=prompt,
                    denoise_value=strength,
                    lora_prompt=lora_prompt or "",
                    seed=seed
                )
                
                if result_images:
                    images.extend(result_images)
                    print(f"[AIDrawService] 第 {i+1}/{count} 张生成成功")
                else:
                    print(f"[AIDrawService] 第 {i+1}/{count} 张生成失败")
            
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
