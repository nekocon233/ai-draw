"""
AI 绘画服务核心模块

直接管理 ComfyUI 调用和状态
"""
import asyncio
import base64
import os
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
    
    async def generate_prompt(self, description: str, workflow_id: Optional[str] = None) -> str:
        """生成 Prompt"""
        try:
            self.is_generating_prompt = True
            self._notify_state_change('is_generating_prompt', True)
            self._notify_state_change('prompt_generation_progress', '正在生成 Prompt...')

            # 获取工作流专属模板（无则回退到全局模板）
            workflow_template = None
            if workflow_id:
                config = get_config()
                if config.workflow_defaults:
                    workflow_template = config.workflow_defaults.get_workflow_prompt_template(workflow_id)

            prompt = await asyncio.to_thread(self.ai_prompt.generate, description, workflow_template)
            
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
        frame_count: Optional[int] = None,
        send_history: bool = False,
        session_id: Optional[str] = None,
        # PixelLab 动画参数
        action: str = "walk",
        view: str = "sidescroller",
        direction: str = "east",
    ) -> list:
        """生成图像 - 使用用户选择的工作流"""
        try:
            self.is_generating = True
            self._notify_state_change('is_generating', True)
            self._notify_state_change('generation_progress', '正在生成...')
            
            # 使用用户选择的工作流
            workflow_type = workflow
            print(f"[AIDrawService] 使用工作流: {workflow_type}")

            # 切换 ComfyUI 工作流（纯 Gemini 工作流无需切换）
            if workflow_type in self.comfyui.workflow_configs and workflow_type != self.comfyui.get_current_workflow_type():
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
            
            # ── i2v：图生视频 ────────────────────────────────────────────────────────────
            elif workflow_type == 'i2v':
                if not image_base64:
                    raise ValueError("i2v 工作流需要提供起始帧图片")

                seed = None
                raw_video_b64 = None

                def i2v_finish_callback(data):
                    nonlocal raw_video_b64
                    raw_video_b64 = data

                await self.comfyui.generate_i2v(
                    finish_callback=i2v_finish_callback,
                    image_base64=image_base64,
                    prompt_text=prompt,
                    seed=seed,
                    frame_count=frame_count,
                    frame_rate=frame_rate,
                )

                if not raw_video_b64:
                    raise Exception("I2V 视频生成失败：未收到有效视频数据")

                raw = raw_video_b64.split(',', 1)[1] if raw_video_b64.startswith('data:') else raw_video_b64
                video_bytes = await asyncio.to_thread(base64.b64decode, raw)

                if target_width is not None and target_height is not None:
                    try:
                        video_bytes = await asyncio.to_thread(
                            resize_video_bytes, video_bytes, target_width, target_height
                        )
                        print(f"[AIDrawService] I2V 视频已 resize 至 {target_width}x{target_height}")
                    except Exception as e:
                        print(f"[AIDrawService] I2V 视频 resize 失败，使用原始视频: {e}")

                save_dir = Path("uploads/video")
                save_dir.mkdir(parents=True, exist_ok=True)
                filename = f"video_{uuid.uuid4().hex}.mp4"
                filepath = save_dir / filename
                try:
                    def _write_i2v_file():
                        with open(filepath, "wb") as vf:
                            vf.write(video_bytes)
                    await asyncio.to_thread(_write_i2v_file)
                    result_video = f"/uploads/video/{filename}"
                except Exception as e:
                    print(f"[AIDrawService] 保存 I2V 视频文件失败: {e}")
                    raise Exception(f"保存视频文件失败: {e}")

                self._notify_state_change('media_generated', {
                    'image': result_video,
                    'index': 0,
                    'total': 1
                })

                images = [result_video]
                print(f"[AIDrawService] i2v 视频生成成功")

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
                    
                    if workflow_type == 'nano_banana_pro':
                        # 全部走 Gemini：有历史携带历史，无历史单轮；参考图直接传入
                        await self.generate_nano_banana_gemini_chat(
                            session_id=session_id or '',
                            current_prompt=prompt,
                            current_image_b64=image_base64,
                            current_image_b64_2=image_base64_2,
                            current_image_b64_3=image_base64_3,
                            finish_callback=finish_callback,
                        )
                    elif workflow_type == 'pixel_lab_animate':
                        # PixelLab 像素动画生成
                        if not image_base64:
                            raise ValueError("像素动画工作流需要提供参考图")
                        await self.generate_pixel_lab_animation(
                            image_base64=image_base64,
                            action=action,
                            view=view,
                            direction=direction,
                            finish_callback=finish_callback,
                        )
                    elif requires_image:
                        # 其他需要参考图的工作流（i2i, reference 等）
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
            print(f"[AIDrawService] 错误: {error_msg}")
            import traceback
            traceback.print_exc()
            self._notify_state_change('generation_progress', error_msg)
            raise
        finally:
            self.is_generating = False
            self._notify_state_change('is_generating', False)
    
    # ── Gemini 多轮对话辅助 ─────────────────────────────────────────────────

    def _load_image_b64(self, path: str) -> Optional[str]:
        """从文件路径或 data URL 读取图片，返回 base64（不含前缀），失败返回 None"""
        try:
            if not path:
                return None
            if path.startswith('data:image'):
                return path.split(',', 1)[1]
            elif path.startswith('/uploads/'):
                # 服务器生成图：/uploads/generated/img_xxx.png → 相对路径
                file_path = Path(path[1:])  # 去掉开头的 /
                if file_path.exists():
                    return base64.b64encode(file_path.read_bytes()).decode('utf-8')
        except Exception as e:
            print(f"[AIDrawService] 读取图片失败 ({str(path)[:60]}): {e}")
        return None

    async def generate_nano_banana_gemini_chat(
        self,
        session_id: str,
        current_prompt: str,
        current_image_b64: Optional[str],
        current_image_b64_2: Optional[str],
        current_image_b64_3: Optional[str],
        finish_callback,
    ):
        """使用 Gemini 多轮对话路径生成图像（nano_banana_pro + send_history）"""
        from server.database import get_db_session
        from server.models import ChatMessage, GeneratedImage
        from utils.gemini_chat import GeminiChat

        from utils.config_loader import get_nano_banana_config
        nano_banana_cfg = get_nano_banana_config()
        if not nano_banana_cfg.api_key:
            raise ValueError("未配置 NANO_BANANA_API_KEY，无法调用 Gemini")

        # ── 从数据库读取历史对话（只取完整轮次：user + assistant 配对） ──
        history = []
        with get_db_session() as db:
            messages = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at.asc())
                .all()
            )

            i = 0
            while i < len(messages):
                msg = messages[i]
                if msg.type != 'user':
                    i += 1
                    continue

                # 跳过 flf2v 工作流的轮次（含其 assistant 回复）
                if msg.workflow == 'flf2v':
                    i += 1
                    if i < len(messages) and messages[i].type == 'assistant':
                        i += 1
                    continue

                # 必须有紧随的 assistant 消息，否则是当前正在进行的请求，跳过
                if i + 1 >= len(messages) or messages[i + 1].type != 'assistant':
                    i += 1
                    continue

                assistant_msg = messages[i + 1]

                # 收集该轮用户上传的图片
                user_images = []
                for ref in [msg.reference_image, msg.reference_image_2, msg.reference_image_3]:
                    b64 = self._load_image_b64(ref)
                    if b64:
                        user_images.append(b64)

                # 收集该轮 AI 生成的图片
                result_images = []
                gen_imgs = (
                    db.query(GeneratedImage)
                    .filter(GeneratedImage.message_id == assistant_msg.message_id)
                    .order_by(GeneratedImage.image_index.asc())
                    .all()
                )
                for gen_img in gen_imgs:
                    b64 = self._load_image_b64(gen_img.file_path)
                    if b64:
                        result_images.append(b64)

                # 跳过图片已被清空的轮次（编辑后重新生成时该轮图片会被清空）
                if not result_images:
                    i += 2
                    continue

                history.append({
                    "prompt": msg.content or "",
                    "images": user_images,
                    "result_images": result_images,
                })
                i += 2

        print(f"[AIDrawService] Gemini 多轮对话，历史轮次: {len(history)}")

        # ── 构建当前图片列表 ───────────────────────────────────────────────
        current_images = [
            img for img in [current_image_b64, current_image_b64_2, current_image_b64_3]
            if img
        ]

        # 无用户参考图时，将最近一轮的生成结果作为 context 注入，帮助模型保持一致性
        last_result_image_b64: Optional[str] = None
        if history:
            for turn in reversed(history):
                imgs = turn.get("result_images") or []
                if imgs:
                    last_result_image_b64 = imgs[-1]
                    break
        context_image = last_result_image_b64 if not current_images else None

        # ── 调用 Gemini（在线程池中执行，避免阻塞事件循环） ───────────────
        gemini = GeminiChat(
            api_key=nano_banana_cfg.api_key,
            base_url=nano_banana_cfg.base_url,
            model_name=nano_banana_cfg.model,
        )
        result_imgs = await asyncio.to_thread(
            gemini.generate,
            current_prompt=current_prompt,
            current_images=current_images,
            history=history,
            context_image=context_image,
        )

        if not result_imgs:
            print("[AIDrawService] Gemini 未返回任何图像")
            finish_callback(None)
            return

        # 回调保存图片（取第一张，与 ComfyUI 路径行为一致）
        finish_callback(f"data:image/png;base64,{result_imgs[0]}")

    async def generate_pixel_lab_animation(
        self,
        image_base64: str,
        action: str,
        view: str,
        direction: str,
        finish_callback,
    ):
        """使用 PixelLab 生成像素动画序列帧"""
        import base64

        from utils.config_loader import get_pixel_lab_config
        from utils.pixel_lab import get_pixel_lab_service

        pixel_lab_cfg = get_pixel_lab_config()
        if not pixel_lab_cfg.api_key:
            raise ValueError("未配置 PIXEL_LAB_API_KEY，无法调用 PixelLab")

        # 解码参考图片
        try:
            image_bytes = base64.b64decode(image_base64)
        except Exception as e:
            raise ValueError(f"参考图片 Base64 解码失败: {e}")

        # 获取 PixelLab 服务
        pixel_lab = get_pixel_lab_service(pixel_lab_cfg.api_key)

        # 在线程池中执行同步的 pixellab 调用
        loop = asyncio.get_event_loop()
        frames = await loop.run_in_executor(
            None,
            self._generate_pixel_lab_frames_sync,
            pixel_lab,
            image_bytes,
            action,
            view,
            direction,
        )

        if not frames:
            print("[AIDrawService] PixelLab 未返回任何帧")
            finish_callback(None)
            return

        # 将所有帧转换为 base64 并返回第一帧（与现有 API 行为一致）
        # 后续帧可以通过额外字段返回或单独处理
        first_frame_b64 = base64.b64encode(frames[0]).decode('utf-8')
        print(f"[AIDrawService] PixelLab 生成 {len(frames)} 帧动画")
        finish_callback(f"data:image/png;base64,{first_frame_b64}")

    def _generate_pixel_lab_frames_sync(
        self,
        pixel_lab,
        image_bytes: bytes,
        action: str,
        view: str,
        direction: str,
    ) -> list:
        """同步生成 PixelLab 动画帧"""
        from utils.pixel_lab import PixelLabService

        if not isinstance(pixel_lab, PixelLabService):
            raise ValueError("pixel_lab 参数类型错误")

        return pixel_lab.animate_with_text(
            reference_image=image_bytes,
            action=action,
            view=view,
            direction=direction,
            no_background=True,
        )

    def clear_previews(self):
        """清空预览图片"""
        self.preview_items = []
        self._notify_state_change('preview_update', {'action': 'clear'})
    
    def switch_workflow(self, workflow_type: str):
        """切换工作流（纯 Gemini 工作流无需加载 ComfyUI 文件）"""
        if workflow_type in self.comfyui.workflow_configs:
            self.comfyui.switch_workflow(workflow_type)
        self._notify_state_change('workflow_type', workflow_type)
    
    def get_available_workflows(self) -> list[str]:
        """获取可用的工作流列表"""
        config = get_config()
        return list(config.workflow_defaults.workflow_metadata.keys())
    
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
