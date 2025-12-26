"""
文件存储工具模块

处理图片的文件系统存储，支持生成图片和参考图片
"""
import os
import base64
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from utils.config_loader import get_config


class FileStorage:
    """文件存储管理器"""
    
    def __init__(self):
        """初始化文件存储"""
        config = get_config()
        self.upload_dir = Path(config.paths.upload_dir)
        self.generated_dir = self.upload_dir / "generated"
        self.reference_dir = self.upload_dir / "reference"
        
        # 确保目录存在
        self._ensure_directories()
    
    def _ensure_directories(self):
        """确保必要的目录存在"""
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.generated_dir.mkdir(parents=True, exist_ok=True)
        self.reference_dir.mkdir(parents=True, exist_ok=True)
    
    def _decode_base64_image(self, base64_data: str) -> bytes:
        """
        解码 base64 图片数据
        
        Args:
            base64_data: base64 编码的图片数据，可能带有 data URL 前缀
            
        Returns:
            解码后的二进制数据
        """
        # 去除 data URL 前缀（如果有）
        if base64_data.startswith('data:image'):
            # 格式: data:image/png;base64,xxxxx
            base64_data = base64_data.split(',', 1)[1]
        
        return base64.b64decode(base64_data)
    
    def save_generated_image(
        self, 
        base64_data: str, 
        user_id: int, 
        message_id: str, 
        index: int
    ) -> str:
        """
        保存生成的图片
        
        Args:
            base64_data: base64 编码的图片数据
            user_id: 用户 ID
            message_id: 消息 ID
            index: 图片索引
            
        Returns:
            相对文件路径（如 generated/123/2025-12-27/msg_abc_0.png）
        """
        # 按用户 ID 和日期组织目录
        today = datetime.now().strftime("%Y-%m-%d")
        user_dir = self.generated_dir / str(user_id) / today
        user_dir.mkdir(parents=True, exist_ok=True)
        
        # 生成文件名：message_id_index.png
        filename = f"{message_id}_{index}.png"
        file_path = user_dir / filename
        
        # 解码并保存
        try:
            image_data = self._decode_base64_image(base64_data)
            with open(file_path, 'wb') as f:
                f.write(image_data)
        except Exception as e:
            raise ValueError(f"保存图片失败: {str(e)}")
        
        # 返回相对路径（相对于 upload_dir）
        relative_path = file_path.relative_to(self.upload_dir)
        return str(relative_path).replace('\\', '/')  # 统一使用 Unix 风格路径
    
    def save_reference_image(
        self, 
        base64_data: str, 
        user_id: int, 
        filename: Optional[str] = None
    ) -> str:
        """
        保存参考图片
        
        Args:
            base64_data: base64 编码的图片数据
            user_id: 用户 ID
            filename: 可选的原始文件名
            
        Returns:
            相对文件路径（如 reference/123/uuid.png）
        """
        # 按用户 ID 组织目录
        user_dir = self.reference_dir / str(user_id)
        user_dir.mkdir(parents=True, exist_ok=True)
        
        # 生成唯一文件名
        if filename:
            # 保留原始扩展名
            ext = Path(filename).suffix or '.png'
        else:
            ext = '.png'
        
        unique_filename = f"{uuid.uuid4().hex}{ext}"
        file_path = user_dir / unique_filename
        
        # 解码并保存
        try:
            image_data = self._decode_base64_image(base64_data)
            with open(file_path, 'wb') as f:
                f.write(image_data)
        except Exception as e:
            raise ValueError(f"保存参考图失败: {str(e)}")
        
        # 返回相对路径
        relative_path = file_path.relative_to(self.upload_dir)
        return str(relative_path).replace('\\', '/')
    
    def get_file_url(self, relative_path: str) -> str:
        """
        获取文件的 URL
        
        Args:
            relative_path: 相对文件路径
            
        Returns:
            完整的 URL 路径（如 /uploads/generated/123/2025-12-27/msg_abc_0.png）
        """
        return f"/uploads/{relative_path}"
    
    def delete_file(self, relative_path: str) -> bool:
        """
        删除文件
        
        Args:
            relative_path: 相对文件路径
            
        Returns:
            是否删除成功
        """
        file_path = self.upload_dir / relative_path
        try:
            if file_path.exists():
                file_path.unlink()
                return True
            return False
        except Exception as e:
            print(f"[FileStorage] 删除文件失败: {e}")
            return False
    
    def cleanup_empty_directories(self):
        """清理空目录（可选的维护任务）"""
        for root, dirs, files in os.walk(self.upload_dir, topdown=False):
            for dir_name in dirs:
                dir_path = Path(root) / dir_name
                try:
                    if not any(dir_path.iterdir()):
                        dir_path.rmdir()
                except Exception:
                    pass


# 全局单例
_file_storage: Optional[FileStorage] = None


def get_file_storage() -> FileStorage:
    """
    获取文件存储单例
    
    Returns:
        FileStorage 实例
    """
    global _file_storage
    if _file_storage is None:
        _file_storage = FileStorage()
    return _file_storage
