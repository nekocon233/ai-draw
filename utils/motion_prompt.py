"""Visual analysis and input-bound snapshots for Ref2VA fixed-scene and reference-shot animation."""
import hashlib
import json

from utils.llm import LanguageModel

MOTION_PROMPT_VERSION = 1
MOTION_PROMPT_POLICY = "reference-actions-primary-v1"
# "pose" keeps the subject image's scene and camera; "shot" takes only its appearance.
MOTION_REFERENCE_MODES = ("pose", "shot")
SHOT_MOTION_PROMPT_POLICY = "reference-shot-v1"
MAX_MOTION_PROMPT_LENGTH = 12000

FIXED_SCENE_RULES = (
    "<Picture 1> is the sole visual baseline for the entire video. Preserve its character identity, "
    "face, hairstyle, expression, costume, colors, body proportions and art style. Preserve the original "
    "background, objects, layout, lighting and color grading. Keep the camera position, angle, distance, "
    "focal length, framing, crop, aspect ratio and the character's scale and overall placement unchanged. "
    "Use one locked-off continuous shot: no pan, tilt, dolly, tracking, zoom, shake, reframing, cuts or parallax. "
    "Do not zoom out or reveal new scenery or previously out-of-frame body parts to accommodate a pose. "
    "Only change the character's pose, with the body movement and clothing deformation necessary to perform it. "
    "Keep stationary background elements still; add no characters, props, wind, facial acting, visual effects "
    "or unrequested speech. Pose references supply body articulation and orientation only, never their "
    "camera viewpoint, framing, background, gray mannequin material, rendering style or editor UI. "
    "The pose reference images are authoritative for the basic actions, target poses and action order. "
    "Supplementary text may specify extra timing, pauses and sound details only; it must not replace, omit, "
    "reverse or add actions that conflict with the images. Follow all reference actions even with no user text. "
    "If any written description conflicts with a reference pose or its order, follow the reference images. "
    "These preservation requirements take priority over any conflicting scene or camera suggestions below."
)

SHOT_REFERENCE_RULES = (
    "<Picture 1> only defines the appearance of <Subject 1>: identity, face, hairstyle, costume, colors, "
    "body proportions and art style, or the look of the object or element it shows. Do not reuse <Picture 1>'s "
    "background, camera viewpoint, framing, crop, composition or pose. The reference pictures are authoritative "
    "for the camera position, angle, distance, shot size, framing and composition, <Subject 1>'s placement and "
    "scale, the body poses, actions and their order, and the scene layout. Replace the person or main element "
    "shown in the references with <Subject 1>; never keep that reference subject's identity, face, hairstyle, "
    "costume or colors, and do not add it as another character. Ignore gray mannequin materials, grids, "
    "skeleton controllers and editor UI; if a reference shows no real scene, use the scene from the description "
    "or keep a simple clean background. Use one continuous take: move the camera and <Subject 1> smoothly "
    "between consecutive reference framings and poses, without cuts. Add no extra characters, props, visual "
    "effects or unrequested speech. Supplementary text may add scene, timing, pauses and sound details only; it "
    "must not replace, omit, reverse or add camera framing or actions that conflict with the references. "
    "If any written description conflicts with the reference images, follow the reference images."
)


def motion_reference_mode(value) -> str:
    """Presets without the field (all historical snapshots) keep the fixed-scene pose mode."""
    return value if value in MOTION_REFERENCE_MODES else "pose"


def motion_prompt_input_hash(character: str, poses, description: str, mode: str = "pose") -> str:
    # The pose policy stays unchanged so existing fixed-scene snapshots remain valid.
    policy = SHOT_MOTION_PROMPT_POLICY if motion_reference_mode(mode) == "shot" else MOTION_PROMPT_POLICY
    source = json.dumps([MOTION_PROMPT_VERSION, policy, character, list(poses), description.strip()], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def current_motion_prompt(snapshot, input_hash: str) -> bool:
    return (isinstance(snapshot, dict) and snapshot.get('version') == MOTION_PROMPT_VERSION
            and snapshot.get('input_hash') == input_hash and isinstance(snapshot.get('prompt'), str)
            and 0 < len(snapshot['prompt'].strip()) <= MAX_MOTION_PROMPT_LENGTH)


def matching_motion_prompt(snapshot, character, poses, description, preset=None):
    if not isinstance(snapshot, dict) or not isinstance(character, str) or not character or not isinstance(poses, (list, tuple)) or not poses:
        return None
    if preset is not None and not isinstance(preset, dict):
        return None
    effective = (preset or {}).get('prompt', '').strip() + (description or '').strip()
    mode = motion_reference_mode((preset or {}).get('motion_reference_mode'))
    return snapshot if current_motion_prompt(snapshot, motion_prompt_input_hash(character, poses, effective, mode)) else None


SHOT_ANALYSIS_SYSTEM = (
    "你为“参考镜头”动画编写中文提示词。第一张图是主体图，只用来确定人物或元素的身份与外观："
    "脸、发型、服装、配色、体型比例和画风；不沿用主体图的背景、镜头、取景、构图和姿势。"
    "其余图片依次为参考1、参考2等，决定镜头位置、角度、距离、景别、取景和构图，主体在画面中的位置与大小，"
    "动作、姿态及先后顺序，以及场景布局。"
    "逐张观察参考图中的机位、景别、构图和主体位置，以及手臂、手势、腿部、头部朝向、躯干与重心，"
    "按顺序描述相邻参考之间连续、平滑的镜头运动与动作过渡。"
    "区分人物自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或图片没有表现的动作。"
    "参考图中的人物或主要元素一律替换为主体，不保留其身份、脸、发型、服装和配色，也不把它添加为其他角色；"
    "白模的灰色材质、网格、骨骼控制器与软件界面全部忽略。"
    "场景和背景以参考图为准；参考图没有实际场景时，按补充文字描述场景，没有补充时保持简洁背景，不编造复杂场景。"
    "全程为一个连续镜头，按参考顺序平滑运镜和衔接动作，不切镜，不添加额外人物、道具、对白或特效。"
    "镜头、构图、基本动作、目标姿态和先后顺序必须从参考图识别，不能由用户补充文字决定。"
    "补充文字只提供场景、节奏、停顿、音效等额外内容，不得替换、删减、颠倒参考图给出的镜头和动作；"
    "冲突时以参考图为准，只保留不冲突的额外要求。没有补充也要完成全部参考镜头与动作。"
    "先简要描述主体需要保持的外观，再按参考编号描述镜头、构图、主体位置与姿态及相互衔接。"
    "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或固定秒数，不把参考图描述成幻灯片。"
)


def analyze_motion_images(character: str, poses, description: str, input_hash: str, mode: str = "pose") -> dict:
    """All images reach the vision model in exactly the order used by Ref2VA."""
    if motion_reference_mode(mode) == "shot":
        prompt = LanguageModel().complete(
            f"共 {len(poses)} 张参考图：第一张输入是主体图，后续输入依次对应参考1至参考{len(poses)}。"
            "请实际观察每张图，生成主体按参考图的镜头、构图与动作表演的提示词。"
            + (f"\n额外补充（不得替代参考图中的镜头和动作）：{description.strip()}" if description.strip()
               else "\n没有额外补充，请完整依据参考图生成镜头与动作。"),
            system=SHOT_ANALYSIS_SYSTEM, images=[character, *poses],
        ).strip()
        return _motion_snapshot(prompt, input_hash)
    system = (
        "你为固定画面的动作参考动画编写中文提示词。第一张图是人物、背景、画风、光照、构图和镜头的唯一基准；"
        "其余图片依次为动作1、动作2等，只提供肢体姿势和身体朝向。"
        "逐张观察动作图中的手臂、手势、腿部、头部朝向、躯干与重心，按顺序描述从原图姿势到各动作的连续过渡。"
        "区分角色自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或图片没有表现的动作。"
        "严格保持第一张图的人物身份、脸、发型、表情、服装、体型、配色、画风、背景物体及布局和光照；"
        "保持原镜头位置、角度、距离、焦距、景别、取景、裁切、画幅及人物在画面中的整体位置和占比。"
        "全程静止机位、单镜头，不推拉摇移、不变焦、不跟拍、不抖动、不切镜，不为展示动作而拉远或补全画外内容。"
        "仅允许完成姿势变化所需的肢体运动与衣物形变，不添加额外表情、人物、道具、对白、风或特效。"
        "白模的材质、背景、拍摄角度、网格、骨骼控制器与软件界面全部忽略。"
        "基本动作、目标姿态和先后顺序必须从动作参考图识别，不能由用户补充文字决定。"
        "补充文字只提供节奏、停顿、音效等额外内容，不得用文字替换、删减、颠倒参考动作或新增不一致的动作；"
        "文字与图中动作冲突时，以动作参考图为准，只保留不冲突的额外要求。用户无需重写动作，没有补充也要完成全部参考动作。"
        "若补充文字要求改变背景、人物外观或镜头，仍必须服从上述固定要求。"
        "先简要描述原图中需要保持的人物和场景，再按动作编号描述观察到的姿态与衔接。"
        "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或固定秒数，不把参考图描述成幻灯片。"
    )
    prompt = LanguageModel().complete(
        f"共 {len(poses)} 张动作参考图：第一张输入是原始角色场景图，后续输入依次对应动作1至动作{len(poses)}。"
        "请实际观察每张图，生成保留原画面、只改变姿势的提示词。"
        + (f"\n额外补充（不得替代图中动作）：{description.strip()}" if description.strip() else "\n没有额外补充，请完整依据图片生成动作。"),
        system=system, images=[character, *poses],
    ).strip()
    return _motion_snapshot(prompt, input_hash)


def _motion_snapshot(prompt: str, input_hash: str) -> dict:
    if not prompt or len(prompt) > MAX_MOTION_PROMPT_LENGTH:
        raise ValueError('动作分析未返回有效长度的提示词，请重试')
    return {'version': MOTION_PROMPT_VERSION, 'input_hash': input_hash, 'prompt': prompt}
