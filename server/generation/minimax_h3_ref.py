"""Subject image plus ordered pose or shot references for MiniMax H3 Ref2VA."""
from comfyui.structures.minimax_h3 import validate_minimax_h3_options
from .contracts import GenerationParameters, MediaOutput, ProviderInput
import asyncio
from dataclasses import replace
from utils.motion_prompt import (
    FIXED_SCENE_RULES, SHOT_REFERENCE_RULES, analyze_motion_images, current_motion_prompt, motion_prompt_input_hash,
)

MAX_MOTION_REFERENCES = 8


def validate_motion_references(parameters: GenerationParameters) -> None:
    validate_minimax_h3_options(parameters.workflow_options)
    if not parameters.reference_image:
        raise ValueError("动作参考视频需要一张角色外观图")
    poses = parameters.motion_reference_images or ()
    if not 1 <= len(poses) <= MAX_MOTION_REFERENCES or any(not isinstance(image, str) or not image.strip() for image in poses):
        raise ValueError("请提供 1 到 8 张按动作顺序排列的姿势参考图")
    if parameters.reference_image_2 or parameters.reference_image_3 or parameters.reference_image_end:
        raise ValueError("请将姿势图片放入动作参考列表")


def motion_reference_prompt(description: str, count: int, analyzed_prompt: str = "", mode: str = "pose") -> str:
    """Roles are deterministic and follow the exact image order sent to ComfyUI."""
    if mode == "shot":
        return shot_reference_prompt(description, count, analyzed_prompt)
    sequence = ", then ".join(f"<Picture {index + 2}>" for index in range(count))
    return (
        "Fixed visual constraints:\n" + FIXED_SCENE_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the sole character from <Picture 1>. Preserve that character's identity, "
        "face, hair, clothing, colors, proportions and illustration style throughout the video.\n"
        f"The ordered pose references are {sequence}. These images provide only body poses, "
        "limb positions, facing direction and the progression of the action. They may depict "
        "untextured 3D mannequins; do not transfer their gray material, blank face, rendering "
        "style or background, and do not add them as other characters.\n\n"
        "summary:\n[reference generation] Animate <Subject 1> performing the ordered reference "
        "poses in one continuous action within the unchanged original scene and fixed camera.\n\n"
        "retention_analysis:\n"
        "<Subject 1>: fully_preserved - retain the appearance and art style from <Picture 1>.\n"
        f"Pose sequence {sequence}: attribute_transfer - transfer only poses and motion to <Subject 1>.\n\n"
        "detailed_description:\n[Shot 1] Keep the same character throughout. "
        f"Perform the poses from {sequence} in this order, with natural continuous movement "
        "between them. Do not display the reference images as a slideshow or a contact sheet. "
        "Begin from the character's original pose and connect the reference poses naturally. "
        "Keep all fixed visual constraints throughout the motion.\n"
        f"Observed poses and approved motion description:\n{analyzed_prompt.strip()}\n\n"
        f"Optional extra details only (reference images determine all basic actions, poses and order):\n{description.strip()}\n\n"
        "Final reminder: preserve <Picture 1>'s character, background, lighting, framing and camera; change only the pose."
    )


def shot_reference_prompt(description: str, count: int, analyzed_prompt: str = "") -> str:
    """<Picture 1> is cited only for the subject's look; each reference anchors a keyframe's composition."""
    sequence = ", then ".join(f"<Picture {index + 2}>" for index in range(count))
    return (
        "Reference constraints:\n" + SHOT_REFERENCE_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the sole character or element shown in <Picture 1>. Preserve its identity, face, hair, "
        "clothing, colors, proportions and art style throughout the video; <Picture 1> defines only this "
        "appearance, not the background, camera, framing or pose.\n"
        f"The ordered shot references are {sequence}. They are composition anchors that define the camera "
        "viewpoint, shot size, framing, the subject's placement and scale, the body pose and the scene of "
        "successive keyframes. The person or element shown in them only stands in for <Subject 1>; they may "
        "depict untextured 3D mannequins, whose gray material, blank face and editor UI must not be transferred.\n\n"
        "summary:\n[reference generation] <Subject 1> performs the ordered reference shots in one continuous take, "
        "following each reference's camera, composition, pose and scene.\n\n"
        "retention_analysis:\n"
        "<Subject 1>: fully_preserved - retain the appearance and art style from <Picture 1>.\n"
        f"Shot references {sequence}: partially_preserved - keep their camera viewpoint, framing, composition, "
        "pose and scene layout, and replace the person or element shown in them with <Subject 1>.\n\n"
        "detailed_description:\n[Shot 1] Keep the same subject throughout. "
        f"The keyframes correspond to {sequence} in this order; move the camera and <Subject 1> smoothly and "
        "continuously between consecutive references. Do not display the reference images as a slideshow or a "
        "contact sheet.\n"
        f"Observed shots and approved motion description:\n{analyzed_prompt.strip()}\n\n"
        "Optional extra details only (reference images determine camera, composition, actions and order):\n"
        f"{description.strip()}\n\n"
        "Final reminder: <Subject 1> keeps only <Picture 1>'s appearance; camera, composition, poses, actions "
        "and scene follow the reference pictures in order."
    )


class MiniMaxH3ReferenceProvider:
    def __init__(self, comfyui):
        self.comfyui = comfyui

    async def enrich(self, request: ProviderInput, progress) -> GenerationParameters:
        params = request.parameters
        provider_params = params.for_provider()
        description, mode = provider_params.prompt, provider_params.motion_reference_mode
        signature = motion_prompt_input_hash(params.reference_image, params.motion_reference_images, description, mode)
        if current_motion_prompt(params.motion_prompt, signature):
            return params
        progress("正在分析参考镜头与动作..." if mode == "shot" else "正在分析动作参考图...")
        try:
            snapshot = await asyncio.to_thread(
                analyze_motion_images, request.images[0], request.motion_images, description, signature, mode,
            )
        except Exception as error:
            raise RuntimeError(f"动作参考图分析失败，未开始视频生成：{error}") from error
        return replace(params, motion_prompt=snapshot)

    async def generate(self, request: ProviderInput) -> MediaOutput:
        duration, _, audio = validate_minimax_h3_options(request.parameters.workflow_options)
        mode = request.parameters.motion_reference_mode
        result = None

        def capture(content):
            nonlocal result
            result = content

        await self.comfyui.generate_minimax_h3_ref(
            finish_callback=capture,
            prompt_text=motion_reference_prompt(
                request.parameters.prompt, len(request.motion_images),
                (request.parameters.motion_prompt or {}).get('prompt', ''), mode,
            ),
            images=[request.images[0], *request.motion_images],
            # Reference shots own the framing, so the automatic canvas follows the first reference.
            duration=duration, aspect_ratio="auto", audio=audio, canvas_image_index=1 if mode == "shot" else 0,
            seed=request.seed,
        )
        if not result:
            raise RuntimeError("MiniMax H3 动作参考未返回视频")
        return MediaOutput(result, "video")
