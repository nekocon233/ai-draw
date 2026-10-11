"""Transport-independent inputs and outputs for generation providers."""
from dataclasses import InitVar, dataclass, replace
from copy import deepcopy
from typing import Literal, Optional, Protocol


@dataclass(frozen=True)
class TaskContext:
    user_id: int
    task_id: str
    workflow: str
    session_id: Optional[str] = None
    message_id: Optional[str] = None
    append_results: bool = False
    result_offset: int = 0


@dataclass(frozen=True)
class GenerationParameters:
    prompt: str
    workflow: str = "qwen_image_21_t2i"
    strength: Optional[float] = None
    lora_prompt: str = ""
    count: int = 1
    # 有序参考图槽位（含空位），@提及"图片N"指槽位号 N。实例上唯一的参考图存储；
    # 构造时的 legacy 三字段（reference_image 等）经 InitVar 吸收，仅在新字段缺省时生效
    reference_images: Optional[tuple[Optional[str], ...]] = None
    reference_image: InitVar[Optional[str]] = None
    reference_image_2: InitVar[Optional[str]] = None
    reference_image_3: InitVar[Optional[str]] = None
    width: Optional[int] = None
    height: Optional[int] = None
    reference_image_end: Optional[str] = None
    use_original_size: bool = True
    action: str = "walk"
    view: str = "sidescroller"
    direction: str = "east"
    workflow_options: Optional[dict] = None
    # Snapshot of the selected preset; `prompt` holds only the user's own description.
    prompt_preset: Optional[dict] = None
    motion_reference_images: Optional[tuple[str, ...]] = None
    motion_prompt: Optional[dict] = None
    # A stored /uploads/reference/{uid}/{hex}.mp4 clip; mutually exclusive with motion_reference_images.
    motion_reference_video: Optional[str] = None
    # Provider view of the preset's image roles, derived by for_provider() and never persisted.
    motion_reference_mode: str = "pose"

    def __post_init__(self, reference_image, reference_image_2, reference_image_3):
        if self.motion_prompt is not None:
            object.__setattr__(self, "motion_prompt", deepcopy(self.motion_prompt))
        if self.motion_reference_images is not None:
            object.__setattr__(self, "motion_reference_images", tuple(self.motion_reference_images))
        if self.reference_images is not None:
            object.__setattr__(self, "reference_images", tuple(self.reference_images))
        else:
            object.__setattr__(self, "reference_images", (reference_image, reference_image_2, reference_image_3))

    def reference_slots(self) -> tuple[Optional[str], ...]:
        """全部参考图槽位（含空位）；构造后必有值。"""
        return self.reference_images or ()

    def for_provider(self) -> "GenerationParameters":
        """Prefix the provider description without changing the saved user text."""
        snapshot = self.prompt_preset or {}
        preset = snapshot.get("prompt", "").strip()
        if not preset:
            return self
        mode = snapshot.get("motion_reference_mode")
        return replace(
            self, prompt=preset + self.prompt.strip(), prompt_preset=None,
            motion_reference_mode=mode if mode in ("shot", "face") else "pose",
        )

    def source_updates(self) -> dict:
        slots = self.reference_slots()
        fields = (
            "workflow", "strength", "count", "lora_prompt",
            "reference_image_end",
            "workflow_options",
            "width", "height", "use_original_size", "prompt_preset",
            "motion_reference_images",
            "motion_reference_video",
            "motion_prompt",
        )
        return {
            "content": self.prompt,
            # 列表列与 legacy 三列双写：回滚与旧读取路径仍可用
            "reference_images": list(slots),
            "reference_image": slots[0] if len(slots) > 0 else None,
            "reference_image_2": slots[1] if len(slots) > 1 else None,
            "reference_image_3": slots[2] if len(slots) > 2 else None,
            **{name: getattr(self, name) for name in fields},
        }


@dataclass(frozen=True)
class ProviderInput:
    parameters: GenerationParameters
    images: tuple[Optional[str], ...]
    end_image: Optional[str] = None
    motion_images: tuple[str, ...] = ()
    # Chosen by the engine for workflows that declare a seed option; image n of a round uses base + n.
    seed: Optional[int] = None
    # Local path of the motion reference video, resolved inside the upload directory.
    motion_video: Optional[str] = None


@dataclass(frozen=True)
class MediaOutput:
    content: str | bytes
    kind: Literal["image", "video"]


class GenerationProvider(Protocol):
    """Produce one artifact; persistence, events and task state belong to the caller."""

    async def generate(self, request: ProviderInput) -> MediaOutput:
        ...
