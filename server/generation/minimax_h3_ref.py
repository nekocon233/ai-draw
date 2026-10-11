"""Subject image plus ordered pose or shot references, or one motion video, for MiniMax H3 Ref2VA."""
from comfyui.structures.minimax_h3 import validate_minimax_h3_options
from .contracts import GenerationParameters, MediaOutput, ProviderInput
import asyncio
from dataclasses import replace
from utils.motion_prompt import (
    FACE_REFERENCE_RULES, FACE_VIDEO_RULES, FIXED_SCENE_RULES, FIXED_SCENE_VIDEO_RULES, SHOT_REFERENCE_RULES,
    SHOT_VIDEO_RULES, analyze_motion_images, analyze_motion_video, current_motion_prompt, motion_prompt_input_hash,
)
from utils.reference_video import motion_video_owner

MAX_MOTION_REFERENCES = 8


def validate_motion_references(parameters: GenerationParameters) -> None:
    validate_minimax_h3_options(parameters.workflow_options)
    slots = parameters.reference_slots()
    if not (slots and slots[0]):
        raise ValueError("动作参考视频需要一张角色外观图")
    poses = parameters.motion_reference_images or ()
    if parameters.motion_reference_video:
        if poses:
            raise ValueError("动作参考图和动作视频只能二选一")
        if motion_video_owner(parameters.motion_reference_video) is None:
            raise ValueError("动作视频地址无效，请重新上传")
    elif not 1 <= len(poses) <= MAX_MOTION_REFERENCES or any(not isinstance(image, str) or not image.strip() for image in poses):
        raise ValueError("请提供 1 到 8 张按动作顺序排列的姿势参考图，或一段动作视频")
    if any(slots[1:]) or parameters.reference_image_end:
        raise ValueError("请将姿势图片放入动作参考列表")


def motion_reference_prompt(description: str, count: int, analyzed_prompt: str = "", mode: str = "pose") -> str:
    """Roles are deterministic and follow the exact image order sent to ComfyUI."""
    if mode == "shot":
        return shot_reference_prompt(description, count, analyzed_prompt)
    if mode == "face":
        return face_reference_prompt(description, count, analyzed_prompt)
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


def face_reference_prompt(description: str, count: int, analyzed_prompt: str = "") -> str:
    """The reference person keeps their outfit and body; only the face and hair come from <Picture 1>."""
    sequence = ", then ".join(f"<Picture {index + 2}>" for index in range(count))
    return (
        "Reference constraints:\n" + FACE_REFERENCE_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the person shown in the ordered references, wearing their original outfit, with the face and "
        "hair of <Picture 1>. <Picture 1> defines only that face and hairstyle, not the clothing, body, background, "
        "camera, framing or pose.\n"
        f"The ordered shot references are {sequence}. They are composition anchors that define the camera viewpoint, "
        "shot size, framing, the person's placement and scale, outfit, body pose and the scene of successive keyframes.\n\n"
        "summary:\n[reference generation] The person from the references performs the ordered reference shots in one "
        "continuous take with the face and hair of <Picture 1>, keeping their own outfit, camera, composition, pose and scene.\n\n"
        "retention_analysis:\n"
        "<Picture 1> (face and hair): attribute_transfer - transfer the face, facial features, skin tone, hairstyle "
        "and hair color to the person in the references.\n"
        f"Shot references {sequence}: partially_preserved - keep their camera viewpoint, framing, composition, the "
        "person's outfit, accessories, body, pose and the scene layout, and replace only the face and hair.\n\n"
        "detailed_description:\n[Shot 1] Keep the same person and outfit throughout. "
        f"The keyframes correspond to {sequence} in this order; move the camera and the person smoothly and "
        "continuously between consecutive references. Do not display the reference images as a slideshow or a "
        "contact sheet.\n"
        f"Observed shots and approved motion description:\n{analyzed_prompt.strip()}\n\n"
        "Optional extra details only (reference images determine camera, composition, outfit, actions and order):\n"
        f"{description.strip()}\n\n"
        "Final reminder: only the face and hair come from <Picture 1>; outfit, body, camera, composition, poses, "
        "actions and scene follow the reference pictures in order."
    )


def motion_video_prompt(description: str, analyzed_prompt: str = "", mode: str = "pose") -> str:
    """<Video 1> transfers only body motion and timing onto the unchanged <Picture 1> scene."""
    if mode == "shot":
        return shot_video_prompt(description, analyzed_prompt)
    if mode == "face":
        return face_video_prompt(description, analyzed_prompt)
    return (
        "Fixed visual constraints:\n" + FIXED_SCENE_VIDEO_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the sole character from <Picture 1>. Preserve that character's identity, "
        "face, hair, clothing, colors, proportions and illustration style throughout the video.\n"
        "<Video 1> is a motion reference: only its performer's body movement, gestures and timing are used. "
        "Its performer, outfit, setting, lighting and camera are not used.\n\n"
        "summary:\n[reference generation] Animate <Subject 1> performing the motion of <Video 1> with the same "
        "rhythm and timing, within the unchanged original scene of <Picture 1> and a fixed camera.\n\n"
        "retention_analysis:\n"
        "<Subject 1>: fully_preserved - retain the appearance and art style from <Picture 1>.\n"
        "<Picture 1> (scene, lighting and camera): fully_preserved - keep the background, lighting, framing and locked-off camera.\n"
        "<Video 1> (body motion and timing): attribute_transfer - transfer only the performer's movement, poses, "
        "gestures and timing to <Subject 1>.\n\n"
        "detailed_description:\n[Shot 1] Keep the same character throughout. Starting from the character's "
        "original pose in <Picture 1>, follow the body movement of <Video 1> from beginning to end with the same "
        "timing; if <Video 1> ends early, hold its final pose. Keep all fixed visual constraints throughout the motion.\n"
        f"Observed motion and approved description:\n{analyzed_prompt.strip()}\n\n"
        f"Optional extra details only (<Video 1> determines all basic actions, poses, order and timing):\n{description.strip()}\n\n"
        "Final reminder: preserve <Picture 1>'s character, background, lighting, framing and camera; copy only "
        "the body motion and timing of <Video 1>."
    )


def shot_video_prompt(description: str, analyzed_prompt: str = "") -> str:
    """Video editing: <Video 1> keeps camera, motion and scene while its performer becomes <Subject 1>."""
    return (
        "Reference constraints:\n" + SHOT_VIDEO_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the sole character or element shown in <Picture 1>. Preserve its identity, face, hair, "
        "clothing, colors, proportions and art style throughout the video; <Picture 1> defines only this "
        "appearance, not the background, camera, framing or pose.\n"
        "<Video 1> is the source video for the target video edit. Its performer only stands in for <Subject 1>.\n\n"
        "summary:\n[video editing] Recreate <Video 1> with its performer replaced by <Subject 1>, keeping the "
        "camera, composition, motion, timing and scene of <Video 1>.\n\n"
        "retention_analysis:\n"
        "<Subject 1>: fully_preserved - retain the appearance and art style from <Picture 1>.\n"
        "<Video 1>: partially_preserved - keep its camera, framing, composition, body motion, timing and scene, "
        "and replace its performer with <Subject 1>.\n\n"
        "detailed_description:\n[Shot 1] Follow <Video 1> from beginning to end with the same timing, with "
        "<Subject 1> in place of the performer; if <Video 1> ends early, hold its final pose and framing. "
        "Do not show <Picture 1> as a still frame.\n"
        f"Observed shots and approved motion description:\n{analyzed_prompt.strip()}\n\n"
        "Optional extra details only (<Video 1> determines camera, composition, actions and timing):\n"
        f"{description.strip()}\n\n"
        "Final reminder: <Subject 1> keeps only <Picture 1>'s appearance; camera, composition, motion, timing "
        "and scene follow <Video 1>."
    )


def face_video_prompt(description: str, analyzed_prompt: str = "") -> str:
    """Video editing that swaps only the performer's face and hair; outfit, body and everything else stay."""
    return (
        "Reference constraints:\n" + FACE_VIDEO_RULES + "\n\n"
        "subject_definitions:\n"
        "<Subject 1> is the performer of <Video 1>, keeping their outfit, accessories and body, with the face and hair "
        "of <Picture 1>. <Picture 1> defines only that face and hairstyle, not the clothing, body, background, camera, "
        "framing or pose.\n"
        "<Video 1> is the source video for the target video edit.\n\n"
        "summary:\n[video editing] Recreate <Video 1> with only the performer's face and hair replaced by those of "
        "<Picture 1>, keeping the outfit, body, camera, composition, motion, timing and scene of <Video 1>.\n\n"
        "retention_analysis:\n"
        "<Picture 1> (face and hair): attribute_transfer - transfer the face, facial features, skin tone, hairstyle "
        "and hair color to the performer of <Video 1>.\n"
        "<Video 1>: partially_preserved - keep its camera, framing, composition, the performer's outfit, accessories, "
        "body, motion, expressions, timing and scene, and replace only the face and hair.\n\n"
        "detailed_description:\n[Shot 1] Follow <Video 1> from beginning to end with the same timing, with "
        "<Subject 1> in place of the original performer; the head follows the original head turns, gaze, expressions "
        "and mouth movements. If <Video 1> ends early, hold its final pose and framing. Do not show <Picture 1> as a "
        "still frame.\n"
        f"Observed shots and approved motion description:\n{analyzed_prompt.strip()}\n\n"
        "Optional extra details only (<Video 1> determines camera, composition, outfit, actions and timing):\n"
        f"{description.strip()}\n\n"
        "Final reminder: only the face and hair come from <Picture 1>; outfit, body, camera, composition, motion, "
        "timing and scene follow <Video 1>."
    )


ANALYSIS_PROGRESS = {
    ("pose", False): "正在分析动作参考图...", ("shot", False): "正在分析参考镜头与动作...",
    ("face", False): "正在分析参考镜头、服装与动作...", ("pose", True): "正在分析动作视频...",
    ("shot", True): "正在分析参考视频的镜头与动作...", ("face", True): "正在分析参考视频的镜头、服装与动作...",
}


class MiniMaxH3ReferenceProvider:
    def __init__(self, comfyui):
        self.comfyui = comfyui

    async def enrich(self, request: ProviderInput, progress) -> GenerationParameters:
        params = request.parameters
        provider_params = params.for_provider()
        description, mode = provider_params.prompt, provider_params.motion_reference_mode
        slots = params.reference_slots()
        video = params.motion_reference_video
        signature = motion_prompt_input_hash(
            slots[0] if slots else None, params.motion_reference_images or (), description, mode, video=video,
        )
        if current_motion_prompt(params.motion_prompt, signature):
            return params
        progress(ANALYSIS_PROGRESS[(mode, bool(video))])
        if video:
            analyze, label = (lambda: analyze_motion_video(
                request.images[0], request.motion_video, description, signature, mode,
            )), "动作视频"
        else:
            analyze, label = (lambda: analyze_motion_images(
                request.images[0], request.motion_images, description, signature, mode,
            )), "动作参考图"
        try:
            snapshot = await asyncio.to_thread(analyze)
        except Exception as error:
            raise RuntimeError(f"{label}分析失败，未开始视频生成：{error}") from error
        return replace(params, motion_prompt=snapshot)

    async def generate(self, request: ProviderInput) -> MediaOutput:
        duration, _, audio = validate_minimax_h3_options(request.parameters.workflow_options)
        mode = request.parameters.motion_reference_mode
        analyzed = (request.parameters.motion_prompt or {}).get('prompt', '')
        result = None

        def capture(content):
            nonlocal result
            result = content

        if request.motion_video:
            # The clip sets the length; the selected duration only applies to pose images.
            prompt_text = motion_video_prompt(request.parameters.prompt, analyzed, mode)
            images = [request.images[0]]
        else:
            prompt_text = motion_reference_prompt(request.parameters.prompt, len(request.motion_images), analyzed, mode)
            images = [request.images[0], *request.motion_images]
        await self.comfyui.generate_minimax_h3_ref(
            finish_callback=capture,
            prompt_text=prompt_text,
            images=images,
            # Reference shots (whole person or face swap) own the framing, so the canvas follows the first reference.
            duration=duration, aspect_ratio="auto", audio=audio, canvas_image_index=0 if mode == "pose" else 1,
            seed=request.seed, video_path=request.motion_video,
        )
        if not result:
            raise RuntimeError("MiniMax H3 动作参考未返回视频")
        return MediaOutput(result, "video")
