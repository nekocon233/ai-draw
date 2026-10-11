"""Visual analysis and input-bound snapshots for Ref2VA fixed-scene, reference-shot and face-swap animation."""
import hashlib
import json

from utils.llm import LanguageModel

MOTION_PROMPT_VERSION = 1
MOTION_PROMPT_POLICY = "reference-actions-primary-v1"
# "pose" keeps the subject image's scene and camera; "shot" takes only its appearance;
# "face" keeps the reference person and outfit and takes only the subject's face and hair.
MOTION_REFERENCE_MODES = ("pose", "shot", "face")
SHOT_MOTION_PROMPT_POLICY = "reference-shot-v1"
FACE_MOTION_PROMPT_POLICY = "reference-face-v1"
# A motion video replaces the ordered pose images; its snapshots never match image-based ones.
VIDEO_MOTION_PROMPT_POLICY = "reference-video-actions-v1"
VIDEO_SHOT_MOTION_PROMPT_POLICY = "reference-video-shot-v1"
VIDEO_FACE_MOTION_PROMPT_POLICY = "reference-video-face-v1"
MOTION_PROMPT_POLICIES = {
    ("pose", False): MOTION_PROMPT_POLICY, ("shot", False): SHOT_MOTION_PROMPT_POLICY,
    ("face", False): FACE_MOTION_PROMPT_POLICY, ("pose", True): VIDEO_MOTION_PROMPT_POLICY,
    ("shot", True): VIDEO_SHOT_MOTION_PROMPT_POLICY, ("face", True): VIDEO_FACE_MOTION_PROMPT_POLICY,
}
MOTION_VIDEO_ANALYSIS_FRAMES = 8
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

FACE_REFERENCE_RULES = (
    "<Picture 1> only defines the head of <Subject 1>: face, facial features, face shape, skin tone, hairstyle "
    "and hair color. Do not reuse <Picture 1>'s clothing, accessories, body shape, background, camera viewpoint, "
    "framing, composition or pose. The reference pictures are authoritative for the camera position, angle, "
    "distance, shot size, framing and composition, the person's placement and scale, their body, build, outfit, "
    "accessories and colors, the body poses, actions and their order, and the scene layout. Keep the person shown "
    "in the references, but replace only their face and hair with those of <Picture 1>, following each reference's "
    "head pose, gaze and expression and blending the head into the references' visual style; never change their "
    "outfit, accessories, body shape or colors, and do not add <Picture 1>'s character as another person. Ignore "
    "gray mannequin materials, grids, skeleton controllers and editor UI; if a reference shows no real scene, use "
    "the scene from the description or keep a simple clean background. Use one continuous take: move the camera "
    "and the person smoothly between consecutive reference framings and poses, without cuts. Add no extra "
    "characters, props, visual effects or unrequested speech. Supplementary text may add scene, timing, pauses and "
    "sound details only; it must not replace, omit, reverse or add camera framing, actions or outfit changes that "
    "conflict with the references. If any written description conflicts with the reference images, follow the "
    "reference images."
)


FIXED_SCENE_VIDEO_RULES = (
    "<Picture 1> is the sole visual baseline for the entire video. Preserve its character identity, "
    "face, hairstyle, expression, costume, colors, body proportions and art style. Preserve the original "
    "background, objects, layout, lighting and color grading. Keep the camera position, angle, distance, "
    "focal length, framing, crop, aspect ratio and the character's scale and overall placement unchanged. "
    "Use one locked-off continuous shot: no pan, tilt, dolly, tracking, zoom, shake, reframing, cuts or parallax. "
    "Do not zoom out or reveal new scenery or previously out-of-frame body parts to accommodate a movement. "
    "<Video 1> is a motion reference only: transfer its performer's body movement, gestures, poses, rhythm and "
    "timing to <Subject 1>. Never copy the performer's identity, face, hairstyle, outfit, body shape or colors, "
    "nor the video's background, props, lighting, camera angle, camera movement, framing, cuts or visual style, "
    "and do not add the performer as another character. Only change the character's pose over time, with the "
    "body movement and clothing deformation necessary to perform it. Keep stationary background elements still; "
    "add no characters, props, wind, facial acting, visual effects or unrequested speech. "
    "<Video 1> is authoritative for the basic actions, poses, their order and timing. Supplementary text may "
    "specify extra timing, pauses and sound details only; it must not replace, omit, reverse or add actions that "
    "conflict with the video. Follow the whole reference motion even with no user text. If any written description "
    "conflicts with <Video 1>, follow the video; any mention of reference or pose images below means <Video 1>. "
    "These preservation requirements take priority over any conflicting scene or camera suggestions below."
)

SHOT_VIDEO_RULES = (
    "<Picture 1> only defines the appearance of <Subject 1>: identity, face, hairstyle, costume, colors, "
    "body proportions and art style, or the look of the object or element it shows. Do not reuse <Picture 1>'s "
    "background, camera viewpoint, framing, crop, composition or pose. <Video 1> is the source video: keep its "
    "camera position, angle, distance, shot size, framing, camera movement and composition, the performer's "
    "placement and scale, every body movement, pose and gesture with its timing, and its scene layout, lighting "
    "and atmosphere. Replace the performer of <Video 1> with <Subject 1>; never keep the performer's identity, "
    "face, hairstyle, costume or colors, and do not add the performer as another character. If several people "
    "appear, replace only the main performer. Follow the shot structure of <Video 1> and add no other cuts, "
    "characters, props, visual effects or unrequested speech. Supplementary text may add details, timing, pauses "
    "and sound only; it must not replace, omit, reverse or add camera framing or actions that conflict with the "
    "video. If any written description conflicts with <Video 1>, follow the video; any mention of reference "
    "images below means <Video 1>."
)

FACE_VIDEO_RULES = (
    "<Picture 1> only defines the head of <Subject 1>: face, facial features, face shape, skin tone, hairstyle "
    "and hair color. Do not reuse <Picture 1>'s clothing, accessories, body shape, background, camera viewpoint, "
    "framing, composition or pose. <Video 1> is the source video: keep its camera position, angle, distance, shot "
    "size, framing, camera movement and composition, the performer's placement, scale, body, build, outfit, "
    "accessories and colors, every body movement, pose, gesture and head turn with its timing, the facial "
    "expressions and mouth movements, and its scene layout, lighting and atmosphere. Replace only the performer's "
    "face and hair with those of <Picture 1>, rendered in the visual style of <Video 1> so that the head blends "
    "with the original body and scene; never change the outfit, accessories, body shape or colors, and do not add "
    "<Picture 1>'s character as another person. If several people appear, change only the main performer. Follow "
    "the shot structure of <Video 1> and add no other cuts, characters, props, visual effects or unrequested "
    "speech. Supplementary text may add details, timing, pauses and sound only; it must not replace, omit, reverse "
    "or add camera framing, actions or outfit changes that conflict with the video. If any written description "
    "conflicts with <Video 1>, follow the video; any mention of reference images below means <Video 1>."
)


def motion_reference_mode(value) -> str:
    """Presets without the field (all historical snapshots) keep the fixed-scene pose mode."""
    return value if value in MOTION_REFERENCE_MODES else "pose"


def motion_prompt_input_hash(character: str, poses, description: str, mode: str = "pose", video: str | None = None) -> str:
    # The pose policy stays unchanged so existing fixed-scene snapshots remain valid.
    policy = MOTION_PROMPT_POLICIES[(motion_reference_mode(mode), bool(video))]
    if video:
        source = [MOTION_PROMPT_VERSION, policy, character, video, description.strip()]
    else:
        source = [MOTION_PROMPT_VERSION, policy, character, list(poses), description.strip()]
    return hashlib.sha256(json.dumps(source, ensure_ascii=False, separators=(",", ":")).encode('utf-8')).hexdigest()


def current_motion_prompt(snapshot, input_hash: str) -> bool:
    return (isinstance(snapshot, dict) and snapshot.get('version') == MOTION_PROMPT_VERSION
            and snapshot.get('input_hash') == input_hash and isinstance(snapshot.get('prompt'), str)
            and 0 < len(snapshot['prompt'].strip()) <= MAX_MOTION_PROMPT_LENGTH)


def matching_motion_prompt(snapshot, character, poses, description, preset=None, video=None):
    if not isinstance(snapshot, dict) or not isinstance(character, str) or not character:
        return None
    if video is not None and (not isinstance(video, str) or not video or poses):
        return None
    if video is None and (not isinstance(poses, (list, tuple)) or not poses):
        return None
    if preset is not None and not isinstance(preset, dict):
        return None
    effective = (preset or {}).get('prompt', '').strip() + (description or '').strip()
    mode = motion_reference_mode((preset or {}).get('motion_reference_mode'))
    signature = motion_prompt_input_hash(character, poses or (), effective, mode, video=video)
    return snapshot if current_motion_prompt(snapshot, signature) else None


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


FACE_ANALYSIS_SYSTEM = (
    "你为“参考镜头换脸”动画编写中文提示词。第一张图是主体图，只用来确定头部外观：脸、五官、脸型、肤色、发型和发色；"
    "不沿用主体图的服装、配饰、体型、背景、镜头、取景、构图和姿势。"
    "其余图片依次为参考1、参考2等，决定镜头位置、角度、距离、景别、取景和构图，人物在画面中的位置与大小，"
    "人物的身体、服装、配饰及其颜色，动作、姿态及先后顺序，以及场景布局。"
    "逐张观察参考图中的机位、景别、构图和人物位置，人物的服装、配饰与体型，以及手臂、手势、腿部、头部朝向、躯干与重心，"
    "按顺序描述相邻参考之间连续、平滑的镜头运动与动作过渡。"
    "区分人物自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或图片没有表现的动作。"
    "只把参考图中人物的脸和头发换成主体的脸和发型，保留参考人物的服装、配饰、体型和配色，不把主体添加为其他角色；"
    "白模的灰色材质、网格、骨骼控制器与软件界面全部忽略。"
    "场景和背景以参考图为准；参考图没有实际场景时，按补充文字描述场景，没有补充时保持简洁背景，不编造复杂场景。"
    "全程为一个连续镜头，按参考顺序平滑运镜和衔接动作，不切镜，不添加额外人物、道具、对白或特效。"
    "镜头、构图、服装、基本动作、目标姿态和先后顺序必须从参考图识别，不能由用户补充文字决定。"
    "补充文字只提供场景、节奏、停顿、音效等额外内容，不得替换、删减、颠倒参考图给出的镜头和动作，也不得改变服装；"
    "冲突时以参考图为准，只保留不冲突的额外要求。没有补充也要完成全部参考镜头与动作。"
    "先简要描述要换上的主体的脸和发型，以及参考人物要保留的服装与体型，再按参考编号描述镜头、构图、人物位置与姿态及相互衔接。"
    "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或固定秒数，不把参考图描述成幻灯片。"
)


def analyze_motion_images(character: str, poses, description: str, input_hash: str, mode: str = "pose") -> dict:
    """All images reach the vision model in exactly the order used by Ref2VA."""
    if motion_reference_mode(mode) == "face":
        prompt = LanguageModel().complete(
            f"共 {len(poses)} 张参考图：第一张输入是主体图，后续输入依次对应参考1至参考{len(poses)}。"
            "请实际观察每张图，生成参考人物换上主体的脸和发型、保留原服装并按参考图的镜头、构图与动作表演的提示词。"
            + (f"\n额外补充（不得替代参考图中的镜头、服装和动作）：{description.strip()}" if description.strip()
               else "\n没有额外补充，请完整依据参考图生成镜头与动作。"),
            system=FACE_ANALYSIS_SYSTEM, images=[character, *poses],
        ).strip()
        return _motion_snapshot(prompt, input_hash)
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


VIDEO_POSE_ANALYSIS_SYSTEM = (
    "你为固定画面的动作迁移动画编写中文提示词。第一张图是人物、背景、画风、光照、构图和镜头的唯一基准；"
    "其余图片是从同一段动作视频中按时间先后均匀抽取的画面，只提供表演者的肢体动作、姿态、节奏和时间。"
    "逐帧观察表演者的手臂、手势、腿部、头部朝向、躯干与重心，按时间顺序描述从原图姿势开始的连续动作，"
    "以及动作的快慢、停顿和节奏，可以用大致的时间先后说明。"
    "区分人物自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或画面没有表现的动作。"
    "严格保持第一张图的人物身份、脸、发型、表情、服装、体型、配色、画风、背景物体及布局和光照；"
    "保持原镜头位置、角度、距离、焦距、景别、取景、裁切、画幅及人物在画面中的整体位置和占比。"
    "全程静止机位、单镜头，不推拉摇移、不变焦、不跟拍、不抖动、不切镜，不为展示动作而拉远或补全画外内容。"
    "不沿用视频中表演者的身份、脸、发型、服装、体型和配色，也不沿用视频的背景、道具、光照、机位、运镜和剪辑，"
    "不把表演者添加为其他角色。仅允许完成动作所需的肢体运动与衣物形变，不添加额外表情、人物、道具、对白、风或特效。"
    "基本动作、姿态、先后顺序和节奏必须从视频画面识别，不能由用户补充文字决定。"
    "补充文字只提供节奏、停顿、音效等额外内容，不得替换、删减、颠倒视频中的动作或新增不一致的动作；"
    "文字与视频冲突时以视频为准，只保留不冲突的额外要求。没有补充也要完成视频中的全部动作。"
    "若补充文字要求改变背景、人物外观或镜头，仍必须服从上述固定要求。"
    "先简要描述原图中需要保持的人物和场景，再按时间顺序描述观察到的动作与衔接。"
    "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或逐帧编号，不把画面描述成幻灯片。"
)

VIDEO_SHOT_ANALYSIS_SYSTEM = (
    "你为“参考镜头”视频换人编写中文提示词。第一张图是主体图，只用来确定人物或元素的身份与外观："
    "脸、发型、服装、配色、体型比例和画风；不沿用主体图的背景、镜头、取景、构图和姿势。"
    "其余图片是从同一段源视频中按时间先后均匀抽取的画面。源视频决定镜头位置、角度、距离、景别、构图和运镜，"
    "表演者在画面中的位置与大小，动作、姿态、节奏和先后顺序，以及场景布局、光照和氛围。"
    "逐帧观察机位与运镜变化、构图和主体位置，以及表演者的手臂、手势、腿部、头部朝向、躯干与重心，"
    "按时间顺序描述连续的镜头运动与动作，可以用大致的时间先后说明节奏。"
    "区分人物自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或画面没有表现的动作。"
    "源视频中的表演者一律替换为主体，不保留其身份、脸、发型、服装和配色，也不把它添加为其他角色；"
    "画面里有多人时只替换主要表演者。保持源视频的镜头结构，不额外切镜，不添加额外人物、道具、对白或特效。"
    "镜头、构图、基本动作、姿态和节奏必须从视频画面识别，不能由用户补充文字决定。"
    "补充文字只提供场景细节、节奏、停顿、音效等额外内容，不得替换、删减、颠倒视频给出的镜头和动作；"
    "冲突时以视频为准，只保留不冲突的额外要求。没有补充也要完成视频中的全部镜头与动作。"
    "先简要描述主体需要保持的外观，再按时间顺序描述镜头、构图、主体位置与动作及相互衔接。"
    "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或逐帧编号，不把画面描述成幻灯片。"
)


VIDEO_FACE_ANALYSIS_SYSTEM = (
    "你为“参考镜头换脸”视频编写中文提示词。第一张图是主体图，只用来确定头部外观：脸、五官、脸型、肤色、发型和发色；"
    "不沿用主体图的服装、配饰、体型、背景、镜头、取景、构图和姿势。"
    "其余图片是从同一段源视频中按时间先后均匀抽取的画面。源视频决定镜头位置、角度、距离、景别、构图和运镜，"
    "表演者在画面中的位置与大小、身体、服装、配饰及其颜色，动作、姿态、表情、节奏和先后顺序，以及场景布局、光照和氛围。"
    "逐帧观察机位与运镜变化、构图和人物位置，表演者的服装、配饰与体型，以及手臂、手势、腿部、头部朝向、躯干与重心，"
    "按时间顺序描述连续的镜头运动与动作，可以用大致的时间先后说明节奏。"
    "区分人物自身的左右与画面左右，无法确认时使用清楚的相对描述，不猜测遮挡肢体、手指或画面没有表现的动作。"
    "只把表演者的脸和头发换成主体的脸和发型，并按源视频的画风融入画面；保留表演者的服装、配饰、体型、配色、动作和表情变化，"
    "不把主体添加为其他角色；画面里有多人时只替换主要表演者。"
    "保持源视频的镜头结构，不额外切镜，不添加额外人物、道具、对白或特效。"
    "镜头、构图、服装、基本动作、姿态和节奏必须从视频画面识别，不能由用户补充文字决定。"
    "补充文字只提供场景细节、节奏、停顿、音效等额外内容，不得替换、删减、颠倒视频给出的镜头和动作，也不得改变服装；"
    "冲突时以视频为准，只保留不冲突的额外要求。没有补充也要完成视频中的全部镜头与动作。"
    "先简要描述要换上的主体的脸和发型，以及表演者要保留的服装与体型，再按时间顺序描述镜头、构图、人物位置与动作及相互衔接。"
    "只输出可用于视频生成的中文提示词，不输出分析过程、Markdown标题或逐帧编号，不把画面描述成幻灯片。"
)

VIDEO_ANALYSIS = {
    "pose": ("原始角色场景图", "生成保留原画面、只按视频动作改变姿势的提示词。", VIDEO_POSE_ANALYSIS_SYSTEM),
    "shot": ("主体图", "生成主体按源视频的镜头、构图与动作表演的提示词。", VIDEO_SHOT_ANALYSIS_SYSTEM),
    "face": ("主体图", "生成表演者换上主体的脸和发型、保留原服装并按源视频的镜头与动作表演的提示词。", VIDEO_FACE_ANALYSIS_SYSTEM),
}


def analyze_motion_video(character: str, video_path, description: str, input_hash: str, mode: str = "pose") -> dict:
    """The subject image comes first, then evenly spaced frames of the stored clip in playback order."""
    from utils.reference_video import sample_reference_frames
    frames = sample_reference_frames(video_path, MOTION_VIDEO_ANALYSIS_FRAMES)
    moments = "、".join(f"{seconds:.1f} 秒" for seconds, _ in frames)
    first, task, system = VIDEO_ANALYSIS[motion_reference_mode(mode)]
    extra = (f"\n额外补充（不得替代视频中的镜头和动作）：{description.strip()}" if description.strip()
             else "\n没有额外补充，请完整依据视频画面生成镜头与动作。")
    prompt = LanguageModel().complete(
        f"共 {len(frames) + 1} 张图：第一张输入是{first}，后续 {len(frames)} 张依次是动作视频在 {moments}处的画面。"
        f"请实际观察每张画面，{task}" + extra,
        system=system, images=[character, *(image for _, image in frames)],
    ).strip()
    return _motion_snapshot(prompt, input_hash)


def _motion_snapshot(prompt: str, input_hash: str) -> dict:
    if not prompt or len(prompt) > MAX_MOTION_PROMPT_LENGTH:
        raise ValueError('动作分析未返回有效长度的提示词，请重试')
    return {'version': MOTION_PROMPT_VERSION, 'input_hash': input_hash, 'prompt': prompt}
