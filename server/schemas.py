"""
API 请求和响应的数据模型
"""
from pydantic import BaseModel
from typing import Optional, List


# ============ Prompt 相关 ============

class GeneratePromptRequest(BaseModel):
    """生成 Prompt 请求"""
    description: str
    workflow_id: Optional[str] = None


class GeneratePromptResponse(BaseModel):
    """生成 Prompt 响应"""
    prompt: str


class PosePresetResponse(BaseModel):
    """姿势预设提示词响应"""
    prompt: str


class AnalyzeImageForPromptRequest(BaseModel):
    """Gemini 以图生词请求（分析单张图片风格/元素/动作/镜头，生成文生图提示词）"""
    image: str        # data URL 格式（含 data:image/... 前缀）
    description: str  # 指定要描述的内容（必填）


class AnalyzeImageForPromptResponse(BaseModel):
    """Gemini 以图生词响应"""
    prompt: str


class AnalyzeFramesForPromptRequest(BaseModel):
    """Gemini 首尾帧分析请求（flf2v：分析首尾帧，生成过渡视频提示词）"""
    image_start: Optional[str] = None  # 首帧 data URL
    image_end: Optional[str] = None    # 尾帧 data URL
    description: Optional[str] = None  # 补充要求（可选）
    is_loop: bool = False               # 是否循环（首尾帧往返过渡）


class AnalyzeFramesForPromptResponse(BaseModel):
    """Gemini 首尾帧分析响应"""
    prompt_start: str  # 首帧描述提示词
    prompt_end: str    # 尾帧描述提示词


# ============ 媒体生成相关 ============

class GenerateMediaRequest(BaseModel):
    """生成图像请求"""
    prompt: str
    workflow: str = "t2i"  # 工作流类型：t2i, i2i, reference, reference_zimage, flf2v
    strength: Optional[float] = None
    lora_prompt: str = ""
    count: int = 1
    reference_image: Optional[str] = None
    reference_image_2: Optional[str] = None  # i2i 第 2 张参考图
    reference_image_3: Optional[str] = None  # i2i 第 3 张参考图
    width: Optional[int] = None  # 图像宽度（部分工作流支持）
    height: Optional[int] = None  # 图像高度（部分工作流支持）
    prompt_end: Optional[str] = None          # flf2v 结束帧提示词
    reference_image_end: Optional[str] = None  # flf2v 结束帧图片
    use_original_size: bool = True             # 是否使用原图尺寸（默认开启）
    is_loop: bool = False                      # flf2v 是否循环生成（首尾往返）
    start_frame_count: Optional[int] = None    # flf2v 起始帧视频帧长度
    end_frame_count: Optional[int] = None      # flf2v 结束帧视频帧长度
    frame_rate: Optional[float] = None         # flf2v 帧率
    frame_count: Optional[int] = None          # i2v 总帧数
    # Gemini 多轮对话（nano_banana_pro 专用）
    send_history: bool = False                 # 是否携带历史对话发送给 Gemini
    session_id: Optional[str] = None          # 当前会话 ID（send_history=True 时必填）
    # PixelLab 动画参数（pixel_lab_animate 专用）
    action: str = "walk"                      # 动画动作
    view: str = "sidescroller"               # 视角
    direction: str = "east"                   # 朝向


class GenerateMediaResponse(BaseModel):
    """生成媒体响应"""
    count: int
    images: List[str]


# ============ 服务状态相关 ============

class ServiceStatusResponse(BaseModel):
    """服务状态响应"""
    available: bool
    message: str
