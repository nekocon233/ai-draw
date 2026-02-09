"""
AI 绘画服务核心模块

直接管理 ComfyUI 调用和状态
"""
import asyncio
from typing import Optional, Dict, Any
import json
import os
from comfyui.comfyui_service import ComfyUIService
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from utils.ai_prompt import AIPrompt
from utils.config_loader import get_config
from server.database import SessionLocal
from server.models import WorkflowDefinition


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
            
            # 处理参考图（如果有）
            image_base64 = None
            if reference_image:
                # 去除 data URL 前缀（如果有）
                if reference_image.startswith('data:image'):
                    # 格式: data:image/png;base64,xxxxx
                    image_base64 = reference_image.split(',', 1)[1]
                else:
                    image_base64 = reference_image

            requires_image = False
            workflow_label = workflow_type

            db = SessionLocal()
            try:
                row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == workflow_type).first()
                if row:
                    requires_image = bool(row.requires_image)
                    workflow_label = row.label or workflow_type
            finally:
                db.close()

            if not requires_image:
                config = get_config()
                workflow_meta = (config.workflow_defaults.workflow_metadata.get(workflow_type, {}) if config.workflow_defaults else {})
                requires_image = bool(workflow_meta.get('requires_image', False))
                workflow_label = workflow_meta.get('label', workflow_label) or workflow_label

            if not requires_image:
                try:
                    template = await self.comfyui.get_workflow_template_dict(workflow_type)
                    if isinstance(template, dict):
                        for node in template.values():
                            if isinstance(node, dict) and node.get("class_type") == "LoadImage":
                                requires_image = True
                                break
                except Exception:
                    pass

            if requires_image and not image_base64:
                raise ValueError(f"工作流 '{workflow_label}' 需要提供参考图")

            bindings, output_node_title, image_binding = self.comfyui.get_runtime_config(workflow_type, requires_image)
            
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

                workflow_snapshot, temp_path = await self.comfyui.create_workflow_snapshot(workflow_type)
                if requires_image and not image_binding:
                    try:
                        with open(temp_path, "r", encoding="utf-8") as f:
                            workflow_dict = json.load(f)
                        if isinstance(workflow_dict, dict):
                            for node in workflow_dict.values():
                                if not isinstance(node, dict):
                                    continue
                                if node.get("class_type") != "LoadImage":
                                    continue
                                meta = node.get("_meta") or {}
                                title = meta.get("title")
                                if title:
                                    image_binding = {"node_title": str(title), "input_name": "image"}
                                    break
                    except Exception:
                        pass
                try:
                    if requires_image:
                        await self.comfyui.generate_i2i_snapshot(
                            workflow=workflow_snapshot,
                            finish_callback=finish_callback,
                            image_base64=image_base64,
                            prompt_text=prompt,
                            denoise_value=strength,
                            lora_prompt=lora_prompt or "",
                            seed=seed,
                            width=width,
                            height=height,
                            bindings=bindings,
                            output_node_title=output_node_title,
                            image_binding=image_binding,
                        )
                    else:
                        await self.comfyui.generate_t2i_snapshot(
                            workflow=workflow_snapshot,
                            finish_callback=finish_callback,
                            prompt_text=prompt,
                            denoise_value=strength,
                            lora_prompt=lora_prompt or "",
                            seed=seed,
                            bindings=bindings,
                            output_node_title=output_node_title,
                        )
                finally:
                    self.comfyui.cleanup_snapshot_file(temp_path)
                
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
_service_instance_workflow_files_sig: Optional[str] = None


def get_ai_draw_service() -> AIDrawService:
    """获取 AI 绘画服务单例"""
    global _service_instance, _service_instance_workflow_files_sig
    config = get_config()
    workflow_files = (config.workflow_defaults.workflow_files if config.workflow_defaults else {}) or {}
    sig = str(sorted(workflow_files.items()))
    if _service_instance is None or _service_instance_workflow_files_sig != sig:
        _service_instance = AIDrawService()
        _service_instance_workflow_files_sig = sig
    return _service_instance
