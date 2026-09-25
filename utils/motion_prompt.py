"""Visual pose analysis and input-bound snapshots for fixed-scene animation."""
import hashlib
import json

from utils.llm import LanguageModel

MOTION_PROMPT_VERSION = 1
MOTION_PROMPT_POLICY = "reference-actions-primary-v1"
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


def motion_prompt_input_hash(character: str, poses, description: str) -> str:
    source = json.dumps([MOTION_PROMPT_VERSION, MOTION_PROMPT_POLICY, character, list(poses), description.strip()], ensure_ascii=False, separators=(",", ":"))
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
    return snapshot if current_motion_prompt(snapshot, motion_prompt_input_hash(character, poses, effective)) else None


def analyze_motion_images(character: str, poses, description: str, input_hash: str) -> dict:
    """All images reach the vision model in exactly the order used by Ref2VA."""
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
    if not prompt or len(prompt) > MAX_MOTION_PROMPT_LENGTH:
        raise ValueError('动作分析未返回有效长度的提示词，请重试')
    return {'version': MOTION_PROMPT_VERSION, 'input_hash': input_hash, 'prompt': prompt}
