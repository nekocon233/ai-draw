"""
API 请求和响应的数据模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal


# ============ Prompt 相关 ============

class GeneratePromptRequest(BaseModel):
    """生成 Prompt 请求"""
    description: str
    workflow_id: Optional[str] = None
    # 所选预设原文，仅作扩写的只读上下文；生成时仍由后端拼接在描述前面
    preset_prompt: str = Field(default="", max_length=8000)


class GeneratePromptResponse(BaseModel):
    """生成 Prompt 响应"""
    prompt: str


class PromptPresetImage(BaseModel):
    """预设中一张参考图的作用"""
    label: str
    role: str
    slot: Optional[Literal[1, 2, 3, "end"]] = None


class PromptPreset(BaseModel):
    """服务端维护的提示词预设"""
    id: str
    title: str
    description: str
    prompt: str
    output_type: Literal["image", "video"] = "image"
    requires_motion_reference: bool = False
    # pose：主体图提供场景与固定镜头，参考图只给姿势；shot：主体图只给外观，镜头与动作跟随参考图
    motion_reference_mode: Literal["pose", "shot"] = "pose"
    workflow_ids: Optional[List[str]] = None  # None keeps historical snapshots compatible.
    hint: str = ""  # 选中后作为输入框占位提示
    images: List[PromptPresetImage] = Field(default_factory=list)


class PromptPresetsResponse(BaseModel):
    """提示词预设列表响应"""
    presets: List[PromptPreset]


class AnalyzeImageForPromptRequest(BaseModel):
    """LLM 以图生词请求（分析图片风格、元素、动作和镜头）"""
    image: str        # data URL 格式（含 data:image/... 前缀）
    description: str  # 指定要描述的内容（必填）


class AnalyzeImageForPromptResponse(BaseModel):
    """LLM 以图生词响应"""
    prompt: str


# ============ 媒体生成相关 ============

class MotionPromptSnapshot(BaseModel):
    version: Literal[1] = 1
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    prompt: str = Field(min_length=1, max_length=12000)


class AnalyzeMotionPromptRequest(BaseModel):
    reference_image: str = Field(min_length=1)
    motion_reference_images: List[str] = Field(min_length=1, max_length=8)
    description: str = Field(default="", max_length=16000)
    motion_reference_mode: Literal["pose", "shot"] = "pose"

class GenerateMediaRequest(BaseModel):
    """生成图像请求"""
    prompt: str
    workflow: str = "qwen_image_21_t2i"  # 工作流标识来自 WorkflowCatalog
    strength: Optional[float] = None
    lora_prompt: str = ""
    count: int = 1
    reference_image: Optional[str] = None
    reference_image_2: Optional[str] = None  # 第 2 张参考图
    reference_image_3: Optional[str] = None  # 第 3 张参考图
    motion_reference_images: Optional[List[str]] = Field(default=None, max_length=8)
    motion_prompt: Optional[MotionPromptSnapshot] = None
    width: Optional[int] = None  # 图像宽度（部分工作流支持）
    height: Optional[int] = None  # 图像高度（部分工作流支持）
    reference_image_end: Optional[str] = None  # 视频尾帧图片
    use_original_size: bool = True             # 是否使用原图尺寸（默认开启）
    # PixelLab 动画参数（pixel_lab_animate 专用）
    action: str = "walk"                      # 动画动作
    view: str = "sidescroller"               # 视角
    direction: str = "east"                   # 朝向
    workflow_options: Optional[dict] = None   # 元数据驱动的工作流选项，如时长、画幅
    prompt_preset: Optional[PromptPreset] = None  # 所选预设快照，生成时拼在 prompt 前面
    # 任务关联（用于服务端落库与断线恢复；前端可选）
    message_id: Optional[str] = Field(default=None, max_length=50)  # 助手消息 ID（{user_msg_id}-reply）
    session_id: Optional[str] = Field(default=None, max_length=50)  # 所属会话 ID
    task_id: Optional[str] = Field(default=None, min_length=1, max_length=64)


class GenerateMediaResponse(BaseModel):
    """生成媒体响应"""
    count: int
    images: List[str]
    task_id: str


# ============ 服务状态相关 ============

class ServiceStatusResponse(BaseModel):
    """服务状态响应"""
    available: bool
    message: str
