"""Transport-independent inputs and outputs for generation providers."""
from dataclasses import dataclass, replace
from copy import deepcopy
from typing import Literal, Optional, Protocol


@dataclass(frozen=True)
class TaskContext:
    user_id: int
    task_id: str
    workflow: str
    session_id: Optional[str] = None
    message_id: Optional[str] = None


@dataclass(frozen=True)
class GenerationParameters:
    prompt: str
    workflow: str = "qwen_image_21_t2i"
    strength: Optional[float] = None
    lora_prompt: str = ""
    count: int = 1
    reference_image: Optional[str] = None
    reference_image_2: Optional[str] = None
    reference_image_3: Optional[str] = None
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
    # Provider view of the preset's image roles, derived by for_provider() and never persisted.
    motion_reference_mode: str = "pose"

    def __post_init__(self):
        if self.motion_prompt is not None:
            object.__setattr__(self, "motion_prompt", deepcopy(self.motion_prompt))
        if self.motion_reference_images is not None:
            object.__setattr__(self, "motion_reference_images", tuple(self.motion_reference_images))

    def for_provider(self) -> "GenerationParameters":
        """Prefix the provider description without changing the saved user text."""
        snapshot = self.prompt_preset or {}
        preset = snapshot.get("prompt", "").strip()
        if not preset:
            return self
        return replace(
            self, prompt=preset + self.prompt.strip(), prompt_preset=None,
            motion_reference_mode="shot" if snapshot.get("motion_reference_mode") == "shot" else "pose",
        )

    def source_updates(self) -> dict:
        fields = (
            "workflow", "strength", "count", "lora_prompt",
            "reference_image", "reference_image_2", "reference_image_3",
            "reference_image_end",
            "workflow_options",
            "width", "height", "use_original_size", "prompt_preset",
            "motion_reference_images",
            "motion_prompt",
        )
        return {"content": self.prompt, **{name: getattr(self, name) for name in fields}}


@dataclass(frozen=True)
class ProviderInput:
    parameters: GenerationParameters
    images: tuple[Optional[str], Optional[str], Optional[str]]
    end_image: Optional[str] = None
    motion_images: tuple[str, ...] = ()


@dataclass(frozen=True)
class MediaOutput:
    content: str | bytes
    kind: Literal["image", "video"]


class GenerationProvider(Protocol):
    """Produce one artifact; persistence, events and task state belong to the caller."""

    async def generate(self, request: ProviderInput) -> MediaOutput:
        ...
