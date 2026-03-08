"""
AI 绘画服务核心模块

直接管理 ComfyUI 调用和状态
"""
import asyncio
import base64
import uuid
from io import BytesIO
from pathlib import Path
from typing import Optional, Any
from PIL import Image
from comfyui.comfyui_service import ComfyUIService
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from utils.ai_prompt import AIPrompt
from utils.config_loader import get_config
from utils.media_processor import resize_image_base64, resize_video_bytes


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
        
        # 预览列表
        self.preview_items = []
        
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
    
    async def generate_media(
        self,
        prompt: str,
        workflow: str = "t2i",
        strength: float = 0.5,
        lora_prompt: str = "",
        count: int = 1,
        reference_image: Optional[str] = None,
        reference_image_2: Optional[str] = None,
        reference_image_3: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        prompt_end: Optional[str] = None,
        reference_image_end: Optional[str] = None,
        use_original_size: bool = True,
        is_loop: bool = False,
        start_frame_count: Optional[int] = None,
        end_frame_count: Optional[int] = None,
        frame_rate: Optional[float] = None,
    ) -> list:
        """生成图像 - 使用用户选择的工作流"""
        try:
            self.is_generating = True
            self._notify_state_change('is_generating', True)
            self._notify_state_change('generation_progress', '正在生成...')
            
            # 使用用户选择的工作流
            workflow_type = workflow
            print(f"[AIDrawService] 使用工作流: {workflow_type}")
            
            # 切换工作流
            if workflow_type != self.comfyui.get_current_workflow_type():
                self.comfyui.switch_workflow(workflow_type)
            
            # 处理开始帧参考图（如果有）
            image_base64 = None
            if reference_image:
                # 去除 data URL 前缀（如果有）
                if reference_image.startswith('data:image'):
                    # 格式: data:image/png;base64,xxxxx
                    image_base64 = reference_image.split(',', 1)[1]
                else:
                    image_base64 = reference_image

            def _strip_data_url(img_str: Optional[str]) -> Optional[str]:
                if not img_str:
                    return None
                return img_str.split(',', 1)[1] if img_str.startswith('data:image') else img_str

            image_base64_2 = _strip_data_url(reference_image_2)
            image_base64_3 = _strip_data_url(reference_image_3)
            
            # 处理结束帧参考图（如果有，flf2v 专用）
            image_end_base64 = None
            if reference_image_end:
                if reference_image_end.startswith('data:image'):
                    image_end_base64 = reference_image_end.split(',', 1)[1]
                else:
                    image_end_base64 = reference_image_end
            
            # 从配置中获取工作流元数据
            config = get_config()
            workflow_meta = config.workflow_defaults.workflow_metadata.get(workflow_type, {})
            requires_image = workflow_meta.get('requires_image', False)

            # 确定后处理 resize 目标尺寸（仅 supports_original_size 工作流生效）
            target_width: Optional[int] = None
            target_height: Optional[int] = None
            if workflow_meta.get('supports_original_size', False):
                if use_original_size and image_base64:
                    try:
                        img_bytes = base64.b64decode(image_base64)
                        pil_img = Image.open(BytesIO(img_bytes))
                        target_width, target_height = pil_img.size
                        print(f"[AIDrawService] use_original_size: 读取原图尺寸 {target_width}x{target_height}")
                    except Exception as e:
                        print(f"[AIDrawService] 读取原图尺寸失败: {e}")
                elif not use_original_size and width is not None and height is not None:
                    target_width, target_height = width, height
                    print(f"[AIDrawService] 目标输出尺寸: {target_width}x{target_height}")
            
            # ── flf2v：首尾帧生视频 ──────────────────────────────────────────
            if workflow_type == 'flf2v':
                if not image_base64:
                    raise ValueError("flf2v 工作流需要提供开始帧图片")
                if not image_end_base64:
                    raise ValueError("flf2v 工作流需要提供结束帧图片")
                
                seed = None
                raw_video_b64 = None  # 只在回调中暂存原始 base64，不做任何阻塞操作

                def video_finish_callback(data):
                    nonlocal raw_video_b64
                    # 回调仅暂存原始数据，阻塞操作（resize/文件写入）统一在 async 上下文执行
                    raw_video_b64 = data

                await self.comfyui.generate_flf2v(
                    finish_callback=video_finish_callback,
                    start_image_base64=image_base64,
                    end_image_base64=image_end_base64,
                    prompt_start=prompt,
                    prompt_end=prompt_end or "",
                    seed=seed,
                    is_loop=is_loop,
                    start_frame_count=start_frame_count,
                    end_frame_count=end_frame_count,
                    frame_rate=frame_rate,
                )

                if not raw_video_b64:
                    raise Exception("视频生成失败：未收到有效视频数据")

                # ── 在 async 上下文中执行阻塞操作，避免事件循环被卡死 ──
                raw = raw_video_b64.split(',', 1)[1] if raw_video_b64.startswith('data:') else raw_video_b64
                video_bytes = await asyncio.to_thread(base64.b64decode, raw)

                # resize（ffmpeg subprocess，必须放到线程中）
                if target_width is not None and target_height is not None:
                    try:
                        video_bytes = await asyncio.to_thread(
                            resize_video_bytes, video_bytes, target_width, target_height
                        )
                        print(f"[AIDrawService] 视频已 resize 至 {target_width}x{target_height}")
                    except Exception as e:
                        print(f"[AIDrawService] 视频 resize 失败，使用原始视频: {e}")

                # 文件写入（也放到线程，避免大文件阻塞）
                save_dir = Path("uploads/video")
                save_dir.mkdir(parents=True, exist_ok=True)
                filename = f"video_{uuid.uuid4().hex}.mp4"
                filepath = save_dir / filename
                try:
                    def _write_file():
                        with open(filepath, "wb") as vf:
                            vf.write(video_bytes)
                    await asyncio.to_thread(_write_file)
                    result_video = f"/uploads/video/{filename}"
                except Exception as e:
                    print(f"[AIDrawService] 保存视频文件失败: {e}")
                    raise Exception(f"保存视频文件失败: {e}")

                # 现在事件循环空闲，WebSocket 连接正常，可以安全推送
                self._notify_state_change('media_generated', {
                    'image': result_video,
                    'index': 0,
                    'total': 1
                })

                images = [result_video]
                print(f"[AIDrawService] flf2v 视频生成成功")
            
            # ── 图像类工作流 ────────────────────────────────────────────────
            else:
                images = []
                for i in range(count):
                    seed = None  # 让方法自动生成
                    
                    # 存储结果
                    result_images = []
                    
                    # 定义回调函数（保存图片到文件后推送 URL，避免大 base64 撑爆 WebSocket）
                    def finish_callback(base64_content, _i=i):
                        if not base64_content:
                            result_images.append(None)
                            self._notify_state_change('media_generated', {
                                'image': None, 'index': _i, 'total': count
                            })
                            return
                        # 去除 data URL 前缀
                        raw = base64_content.split(',', 1)[1] if base64_content.startswith('data:') else base64_content
                        # 后处理 resize（如有目标尺寸）
                        if target_width is not None and target_height is not None:
                            try:
                                raw = resize_image_base64(raw, target_width, target_height)
                                print(f"[AIDrawService] 图像已 resize 至 {target_width}x{target_height}")
                            except Exception as e:
                                print(f"[AIDrawService] resize 失败，使用原始图像: {e}")
                        # 保存到文件
                        save_dir = Path("uploads/generated")
                        save_dir.mkdir(parents=True, exist_ok=True)
                        filename = f"img_{uuid.uuid4().hex}.png"
                        filepath = save_dir / filename
                        try:
                            with open(filepath, "wb") as _f:
                                _f.write(base64.b64decode(raw))
                            image_url = f"/uploads/generated/{filename}"
                        except Exception as e:
                            print(f"[AIDrawService] 保存图片文件失败: {e}")
                            # 降级：发送 base64（小图片时可用）
                            image_url = f"data:image/png;base64,{raw}"
                        result_images.append(image_url)
                        # 推送文件 URL（轻量），不再推送完整 base64
                        self._notify_state_change('media_generated', {
                            'image': image_url,
                            'index': _i,
                            'total': count
                        })
                    
                    if requires_image:
                        # 需要参考图的工作流
                        if not image_base64:
                            workflow_label = workflow_meta.get('label', workflow_type)
                            raise ValueError(f"工作流 '{workflow_label}' 需要提供参考图")
                        
                        await self.comfyui.generate_i2i(
                            finish_callback=finish_callback,
                            image_base64=image_base64,
                            image_base64_2=image_base64_2,
                            image_base64_3=image_base64_3,
                            prompt_text=prompt,
                            denoise_value=strength,
                            lora_prompt=lora_prompt or "",
                            seed=seed,
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
                        'id': len(self.preview_items) + 1,
                        'image': img,
                        'workflow': workflow_type
                    }
                    self.preview_items.append(preview_data)
                    self._notify_state_change('preview_update', {
                        'action': 'add',
                        'data': preview_data
                    })
            
            self._notify_state_change('generation_progress', '生成完成')
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
        self.preview_items = []
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
