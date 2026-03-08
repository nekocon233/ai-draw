"""
API 请求和响应的数据模型
"""
from pydantic import BaseModel
from typing import Optional, List


# ============ Prompt 相关 ============

class GeneratePromptRequest(BaseModel):
    """生成 Prompt 请求"""
    description: str


class GeneratePromptResponse(BaseModel):
    """生成 Prompt 响应"""
    prompt: str


# ============ 媒体生成相关 ============

class GenerateMediaRequest(BaseModel):
    """生成图像请求"""
    prompt: str
    workflow: str = "t2i"  # 工作流类型：t2i, i2i, reference, reference_zimage, flf2v
    strength: float = 0.5
    lora_prompt: str = ""
    count: int = 1
    reference_image: Optional[str] = None
    width: Optional[int] = None  # 图像宽度（部分工作流支持）
    height: Optional[int] = None  # 图像高度（部分工作流支持）
    prompt_end: Optional[str] = None          # flf2v 结束帧提示词
    reference_image_end: Optional[str] = None  # flf2v 结束帧图片
    use_original_size: bool = True             # 是否使用原图尺寸（默认开启）
    is_loop: bool = False                      # flf2v 是否循环生成（首尾往返）
    start_frame_count: Optional[int] = None    # flf2v 起始帧视频帧长度
    end_frame_count: Optional[int] = None      # flf2v 结束帧视频帧长度
    frame_rate: Optional[float] = None         # flf2v 帧率


class GenerateMediaResponse(BaseModel):
    """生成媒体响应"""
    count: int
    images: List[str]


# ============ 服务状态相关 ============

class ServiceStatusResponse(BaseModel):
    """服务状态响应"""
    available: bool
    message: str
