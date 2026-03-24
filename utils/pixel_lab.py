"""
PixelLab 服务模块

提供像素画动画生成功能
基于 PixelLab API: https://api.pixellab.ai/v1
"""
import io
import asyncio
from typing import Optional, List, Tuple
from PIL import Image

import pixellab


class PixelLabService:
    """PixelLab 动画生成服务"""

    def __init__(self, api_key: str):
        """
        初始化 PixelLab 服务

        Args:
            api_key: PixelLab API 密钥
        """
        if not api_key:
            raise ValueError("PixelLab API key 未配置")

        self.client = pixellab.Client(secret=api_key)
        self._supported_actions = ["walk", "run", "jump", "attack", "idle", "dance", "spell", "hurt"]
        self._supported_views = ["low top-down", "high top-down", "sidescroller"]
        self._supported_directions = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

    @property
    def supported_actions(self) -> List[str]:
        """支持的动画动作列表"""
        return self._supported_actions

    @property
    def supported_views(self) -> List[str]:
        """支持的视角列表"""
        return self._supported_views

    @property
    def supported_directions(self) -> List[str]:
        """支持的朝向列表"""
        return self._supported_directions

    def validate_parameters(
        self,
        action: str,
        view: str,
        direction: str,
    ) -> Tuple[bool, str]:
        """
        验证参数是否有效

        Args:
            action: 动作
            view: 视角
            direction: 朝向

        Returns:
            (是否有效, 错误信息)
        """
        if action not in self._supported_actions:
            return False, f"不支持的动作: {action}，支持: {', '.join(self._supported_actions)}"

        if view not in self._supported_views:
            return False, f"不支持的视角: {view}，支持: {', '.join(self._supported_views)}"

        if direction not in self._supported_directions:
            return False, f"不支持的朝向: {direction}，支持: {', '.join(self._supported_directions)}"

        return True, ""

    async def animate_with_text(
        self,
        reference_image: bytes,
        action: str = "walk",
        view: str = "sidescroller",
        direction: str = "east",
        no_background: bool = True,
    ) -> List[bytes]:
        """
        使用文字描述生成动画帧

        Args:
            reference_image: 参考图片（PNG/JPG bytes）
            action: 动作描述，如 "walk", "run", "jump", "attack", "idle"
            view: 视角，如 "sidescroller", "low top-down", "high top-down"
            direction: 朝向，如 "east", "south", "north"
            no_background: 是否透明背景

        Returns:
            动画帧列表（PNG bytes）
        """
        valid, error = self.validate_parameters(action, view, direction)
        if not valid:
            raise ValueError(error)

        # 在线程池中执行同步的 pixellab 调用
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            self._animate_sync,
            reference_image,
            action,
            view,
            direction,
            no_background,
        )
        return result

    def _animate_sync(
        self,
        reference_image: bytes,
        action: str,
        view: str,
        direction: str,
        no_background: bool,
    ) -> List[bytes]:
        """
        同步执行动画生成
        """
        # 读取参考图片
        img = Image.open(io.BytesIO(reference_image))

        # 验证图片尺寸
        if img.width > 256 or img.height > 256:
            raise ValueError(f"参考图片尺寸过大: {img.width}x{img.height}，最大支持 256x256")

        if img.width < 32 or img.height < 32:
            raise ValueError(f"参考图片尺寸过小: {img.width}x{img.height}，最小支持 32x32")

        # 调用 PixelLab API
        response = self.client.animate_with_text(
            image=img,
            action=action,
            view=view,
            direction=direction,
            no_background=no_background,
        )

        # 提取帧图片
        frames = []
        for frame in response.frames:
            # frame 是 PIL Image 或类似对象
            if hasattr(frame, 'pil_image'):
                pil_img = frame.pil_image()
            elif isinstance(frame, Image.Image):
                pil_img = frame
            else:
                pil_img = frame

            # 转换为 bytes
            buf = io.BytesIO()
            pil_img.save(buf, format='PNG')
            frames.append(buf.getvalue())

        return frames

    async def generate_sprite_sheet(
        self,
        reference_image: bytes,
        action: str = "walk",
        view: str = "sidescroller",
        direction: str = "east",
        no_background: bool = True,
    ) -> bytes:
        """
        生成精灵图序列帧

        Args:
            reference_image: 参考图片
            action: 动作
            view: 视角
            direction: 朝向
            no_background: 透明背景

        Returns:
            精灵图 bytes（4x4 网格排列）
        """
        frames = await self.animate_with_text(
            reference_image=reference_image,
            action=action,
            view=view,
            direction=direction,
            no_background=no_background,
        )

        if not frames:
            raise ValueError("未生成任何帧")

        # 读取所有帧
        pil_frames = []
        for frame_bytes in frames:
            img = Image.open(io.BytesIO(frame_bytes))
            pil_frames.append(img)

        # 计算网格尺寸（4x4 或其他）
        frame_count = len(pil_frames)
        if frame_count <= 4:
            cols, rows = 2, 2
        elif frame_count <= 16:
            cols, rows = 4, 4
        elif frame_count <= 25:
            cols, rows = 5, 5
        else:
            cols, rows = 4, (frame_count + 3) // 4

        # 获取单帧尺寸
        frame_width, frame_height = pil_frames[0].size

        # 创建精灵图
        sheet_width = cols * frame_width
        sheet_height = rows * frame_height
        sprite_sheet = Image.new('RGBA', (sheet_width, sheet_height), (0, 0, 0, 0))

        # 排列帧
        for i, frame in enumerate(pil_frames):
            col = i % cols
            row = i // cols
            x = col * frame_width
            y = row * frame_height
            sprite_sheet.paste(frame, (x, y))

        # 转换为 bytes
        buf = io.BytesIO()
        sprite_sheet.save(buf, format='PNG')
        return buf.getvalue()


# 全局实例
_pixel_lab_service: Optional[PixelLabService] = None


def get_pixel_lab_service(api_key: str = None) -> PixelLabService:
    """
    获取 PixelLab 服务实例（单例）

    Args:
        api_key: 可选，手动指定 API key

    Returns:
        PixelLabService 实例
    """
    global _pixel_lab_service

    if api_key is None:
        from utils.config_loader import get_pixel_lab_config
        config = get_pixel_lab_config()
        api_key = config.api_key

    if _pixel_lab_service is None:
        _pixel_lab_service = PixelLabService(api_key)

    return _pixel_lab_service


def reset_pixel_lab_service():
    """重置 PixelLab 服务实例（用于测试或重新初始化）"""
    global _pixel_lab_service
    _pixel_lab_service = None
