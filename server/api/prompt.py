"""Authenticated prompt generation and image analysis endpoints."""
import asyncio
from fastapi import APIRouter, HTTPException, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.auth import get_current_user
from server.models import User
from server.database import get_db
from sqlalchemy.orm import Session
from server.schemas import (
    GeneratePromptRequest, GeneratePromptResponse,
    PromptPreset, PromptPresetImage, PromptPresetsResponse,
    AnalyzeImageForPromptRequest, AnalyzeImageForPromptResponse,
    AnalyzeMotionPromptRequest, MotionPromptSnapshot,
)
from utils.llm import InvalidImageError
from utils.prompt_analysis import describe_image
from utils.motion_prompt import motion_prompt_input_hash
from utils.image_reference import normalize_image_reference
from utils.config_loader import get_config

# Generation appends the user's description directly, so every preset ends its last sentence.
PROMPT_PRESETS = (
    PromptPreset(
        id="pose",
        title="参考姿势",
        description="让参考图 1 中的角色跟随参考图 2 的动作",
        prompt="参照第二张图中人物的动作和姿态，将第一张图角色做出完全相同的动作，严格保持第一张图的画面尺寸、长宽比例、画风、镜头距离与视角、角色外形及背景，不得改变取景范围和画面裁切方式。",
        hint="可补充表情、手势等细节要求",
        images=[
            PromptPresetImage(label="参考图 1", role="角色、画风与背景"),
            PromptPresetImage(label="参考图 2", role="动作与身体姿态"),
        ],
    ),
    # Only finishing requirements: the selected LoRA decides the painting style.
    PromptPreset(
        # Preserve the ID used by saved selections and training data preparation.
        id="sketch_finish",
        title="参考图成品化",
        description="只借用姿势与构图，主动重建缺失细节并完整上色，将粗稿重新绘制为完整成品，画风由所选 LoRA 决定",
        prompt=(
            "@图片1 仅用于参考人物的姿势、动作、构图、镜头角度和画面比例。"
            "保持整体姿态、人物在画面中的位置与占比、镜头角度、取景范围和画面长宽比不变。"
            "依据这些结构信息和补充描述，重新绘制完整、精修的最终成品，输出完成度不受参考图完成度限制。"
            "成品必须完整上色：即使参考图是黑白线稿、灰度草图或只上了部分颜色，也要给皮肤、头发、眼睛、服装和配饰全部上色，"
            "颜色以补充描述为准，未指定的部分自行合理配色；除非补充描述另有要求，不要输出黑白、灰度或只有线条的画面。"
            "人物外观、服装等以补充描述为准，不照搬参考图的角色外观、服装或背景；"
            "参考图中缺失、模糊或简化的细节需要主动推断和补全，不能作为最终效果保留。"
            "若参考图是草稿，先理解简略线条表达的身体结构与动作意图，再重新构建清晰、合理的轮廓和细节；"
            "在不改变整体姿态与构图的前提下，修正局部解剖、透视和遮挡关系，不要逐笔照描或只在草稿上填色。"
            "完整绘制画面中可见的五官、眼睛、头发、手脚和服装结构；"
            "即使草稿没有画出这些细节，也要按补充描述合理完成，服装边缘、接缝和必要褶皱清楚，肢体连接与前后遮挡明确。"
            "全图应达到一致的成品完成度：轮廓干净连贯，上色完整且边界准确，明暗充分、光源方向统一，补齐必要的接触阴影；"
            "不要留下空白漏色、溢色、未完成的局部、抖线、重复线、断线、铅笔线、辅助线或涂抹痕迹。"
            "背景使用单一、均匀的纯色，不添加场景、图案、纹理或颜色过渡。"
            "不要保留或生成 HUD、UI、软件界面、工具栏、按钮、菜单、界面文字、坐标轴、辅助网格、选中框或骨骼控制器。"
        ),
        hint="补充人物外观、服装配色、背景颜色等具体要求",
        images=[PromptPresetImage(label="参考图 1", role="姿势、动作、构图、镜头角度与画面比例；也可使用草稿")],
    ),
    # Structure only: no style words, so the selected LoRA alone decides the rendering.
    PromptPreset(
        id="pose_composition",
        title="仅参考姿势构图",
        description="只沿用参考图的姿势、动作、构图、镜头角度和画面比例，画风完全由所选 LoRA 决定，人物外观与背景按补充描述生成",
        prompt=(
            "@图片1 仅用于参考人物的姿势、动作、构图、镜头角度和画面比例。"
            "保持整体姿态、人物在画面中的位置与占比、镜头角度、取景范围和画面长宽比不变。"
            "除这些结构信息外，参考图的其他内容一律不沿用：不照搬其中人物的长相、发型、服装、配饰、配色和背景，"
            "也不沿用它的线条、笔触、光影、材质与质感。"
            "若参考图是照片、白模、3D 人偶或草稿，只理解其中的身体结构与动作，不保留原有的材质、颜色和线条。"
            "人物外观、服装、配色和背景按补充描述重新绘制，补充描述没有提到的部分自行合理设计；未提到背景时使用简洁的背景。"
            "重新绘制完整的成品画面，不要在参考图上局部修改、描线或填色。"
            "不要保留或生成 HUD、UI、软件界面、工具栏、按钮、菜单、界面文字、坐标轴、辅助网格、选中框或骨骼控制器。"
        ),
        hint="补充人物外观、服装配色、背景等要求",
        images=[PromptPresetImage(label="参考图 1", role="姿势、动作、构图、镜头角度与画面比例")],
    ),
    PromptPreset(
        id="video_motion",
        title="自然动作",
        description="以输入画面为基础，保持主体一致，按描述生成连贯自然的动作",
        output_type="video",
        workflow_ids=["minimax_h3"],
        prompt=(
            "以本段起始画面中的主体和场景为依据，保持主体外观、服装、场景布局和画面比例一致。"
            "按照补充描述生成连贯自然的动作，动作起始、发展和结束衔接顺畅，重心、关节运动和惯性合理。"
            "动作幅度与速度符合描述，未指定运镜时保持镜头平稳，不无故切换场景；"
            "避免突然跳变、肢体扭曲、主体外观漂移、闪烁和画面撕裂。"
        ),
        hint="描述主体要做的动作、幅度和速度",
        images=[PromptPresetImage(label="开始帧", role="主体外观、服装与场景", slot=1)],
    ),
    PromptPreset(
        id="video_fixed_camera",
        title="固定镜头动作",
        description="固定人物、背景和镜头，主体按动作参考图运动；文字仅补充额外细节",
        output_type="video",
        requires_motion_reference=True,
        workflow_ids=["minimax_h3_ref"],
        prompt=(
            "以原始画面中的主体和场景为基准，保持主体身份、外观、服装、画风、背景布局与光照不变，"
            "镜头位置、角度、距离、景别、取景、裁切和画面比例始终固定。"
            "主体必须按照动作参考图中的动作与姿态运动，多张动作图按提供顺序依次完成，并自然衔接中间过程。"
            "基本动作、肢体姿态和动作顺序由动作参考图决定，不需要用户重复描述动作。"
            "用户手动补充的文字只描述节奏、停顿、音效等额外内容，不得替换、删减、颠倒图中动作或添加不一致的新动作；"
            "文字与动作图冲突时，以动作参考图为准，没有补充文字时也要完成参考图给出的动作。"
            "只借用动作图的姿势，不引入其人物外观、材质、背景或拍摄视角。"
            "背景保持稳定，不推拉、摇移、缩放、抖动或切换镜头，不为展示动作改变取景；"
            "保持肢体结构稳定，避免主体外观漂移、肢体扭曲和画面闪烁。"
        ),
        hint="仅补充节奏、停顿、音效等额外内容；动作按参考图生成，可留空",
        images=[PromptPresetImage(label="原始画面", role="主体外观、场景与固定镜头；动作由独立的动作参考图提供", slot=1)],
    ),
    # The subject image supplies only appearance; the shot mode also switches the server-side rules.
    PromptPreset(
        id="video_reference_shot",
        title="参考镜头动作",
        description="主体图只提供人物或元素，镜头、构图、动作与姿势跟随参考图",
        output_type="video",
        requires_motion_reference=True,
        motion_reference_mode="shot",
        workflow_ids=["minimax_h3_ref"],
        prompt=(
            "主体图只用于确定人物或元素的身份与外观，包括脸、发型、服装、配色、体型比例和画风，"
            "不沿用主体图的背景、镜头、取景、构图和姿势。"
            "镜头位置、角度、距离、景别与构图，主体在画面中的位置和大小，以及动作、姿态和先后顺序都以参考图为准，"
            "多张参考图按提供顺序依次完成，并以连续镜头平滑衔接。"
            "参考图中的人物或主要元素替换为主体，不保留其原有身份、外貌和服装，也不引入白模材质、网格或软件界面。"
            "场景和背景同样以参考图为准；参考图没有实际场景时，按补充描述或保持简洁背景。"
            "用户手动补充的文字只描述场景、节奏、停顿、音效等额外内容，不得改变参考图给出的镜头和动作。"
        ),
        hint="可补充场景、节奏、停顿、音效等细节；镜头与动作按参考图生成，可留空",
        images=[PromptPresetImage(label="主体图", role="只提供人物或元素的外观；不沿用背景、镜头、构图和姿势", slot=1)],
    ),
    PromptPreset(
        id="video_transition",
        title="首尾帧过渡",
        description="连接本段起始帧与结束帧，补齐两端之间的连续动作",
        output_type="video",
        workflow_ids=["minimax_h3"],
        prompt=(
            "以本段起始帧和结束帧为两端约束，按补充描述从起始状态连续、自然地过渡到目标状态。"
            "合理补齐两端之间的运动过程、重心变化和遮挡关系，保持主体身份及未要求变化的外观与场景细节一致。"
            "开头与结尾分别衔接对应输入画面，镜头变化应平稳连续；"
            "不要用突然切镜、叠影或闪白代替动作过渡，避免肢体扭曲和画面闪烁。"
        ),
        hint="可补充首尾帧之间的动作节奏、衔接和声音要求，也可留空",
        images=[
            PromptPresetImage(label="开始帧", role="本段起始状态", slot=1),
            PromptPresetImage(label="结束帧", role="本段目标状态", slot="end"),
        ],
    ),
)

router = APIRouter(prefix="/prompt", tags=["Prompt生成"], dependencies=[Depends(get_current_user)])


@router.post("/generate", response_model=GeneratePromptResponse)
async def generate_prompt(
    request: GeneratePromptRequest,
    current_user: User = Depends(get_current_user),
    service: AIDrawService = Depends(get_ai_draw_service),
) -> GeneratePromptResponse:
    try:
        prompt = await service.generate_prompt(
            request.description, request.workflow_id, user_id=current_user.id, preset_prompt=request.preset_prompt,
        )
        return GeneratePromptResponse(prompt=prompt)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/presets", response_model=PromptPresetsResponse)
async def get_prompt_presets() -> PromptPresetsResponse:
    return PromptPresetsResponse(presets=list(PROMPT_PRESETS))


@router.post("/analyze-image", response_model=AnalyzeImageForPromptResponse)
async def analyze_image_for_prompt(request: AnalyzeImageForPromptRequest) -> AnalyzeImageForPromptResponse:
    if not request.image:
        raise HTTPException(status_code=400, detail="请提供图片")
    if not request.description or not request.description.strip():
        raise HTTPException(status_code=400, detail="请指定要描述的内容")
    try:
        prompt = await asyncio.to_thread(describe_image, request.image, request.description)
        return AnalyzeImageForPromptResponse(prompt=prompt)
    except InvalidImageError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"LLM 图片分析失败：{error}") from error


@router.post("/analyze-motion", response_model=MotionPromptSnapshot)
async def analyze_motion_for_prompt(
    request: AnalyzeMotionPromptRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: AIDrawService = Depends(get_ai_draw_service),
) -> MotionPromptSnapshot:
    from server.api.generation import _validate_reference_ownership
    references = [request.reference_image, *request.motion_reference_images]
    for index, image in enumerate(references):
        _validate_reference_ownership(image, current_user.id, db, '原始画面' if index == 0 else f'动作参考 {index}')
    try:
        images = await asyncio.to_thread(lambda: [
            normalize_image_reference(image, get_config().paths.upload_dir, '原始画面' if index == 0 else f'动作参考 {index}')
            for index, image in enumerate(references)
        ])
    except (ValueError, InvalidImageError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    mode = request.motion_reference_mode
    signature = motion_prompt_input_hash(request.reference_image, request.motion_reference_images, request.description, mode)
    try:
        snapshot = await service.analyze_motion_prompt(images[0], images[1:], request.description, signature, current_user.id, mode)
        return MotionPromptSnapshot(**snapshot)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"动作参考图分析失败：{error}") from error
