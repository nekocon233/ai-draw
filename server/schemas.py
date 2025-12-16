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


# ============ 图像生成相关 ============

class GenerateImageRequest(BaseModel):
    """生成图像请求"""
    prompt: str
    strength: float = 0.5
    lora_prompt: str = ""
    count: int = 1
    workflow_type: str = "参考"
    reference_image: Optional[str] = None


class GenerateImageResponse(BaseModel):
    """生成图像响应"""
    count: int
    images: List[str]


# ============ 服务状态相关 ============

class ServiceStatusResponse(BaseModel):
    """服务状态响应"""
    available: bool
    message: str
