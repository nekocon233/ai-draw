# Qwen-Image-2.1

## 官方来源

- 发布与代码：<https://github.com/QwenLM/Qwen-Image-2.1>，2026-09-20 发布。
- 原始模型：<https://huggingface.co/Qwen/Qwen-Image-2.1>。
- ComfyUI 适配权重：<https://huggingface.co/Comfy-Org/Qwen-Image-2.1>。
- 官方文生图模板：<https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json>。
- 官方编辑模板：<https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json>。

模型采用 Qwen Research License，仅限非商业研究与评估，商业用途需单独授权。以模型仓库的 LICENSE 为准。

## 应用接入

“生图”分类提供 Z-Image、Qwen-Image-2.1 和 GPT Image。Qwen-Image-2.1 没有参考图时使用 `qwen_image_21_t2i`，添加图片后使用 `qwen_image_21_i2i`。删除首图但保留其他图时继续使用编辑模式，提交前按顺序压紧参考图槽位。两种模式共用 LoRA 和提示词。

模型本身支持最多十张参考图；本次应用接入沿用三张参考图的 API、会话与界面契约。第一张作为编辑目标，其余图片作为参考，指令可使用 `<image1>`、`<image2>`、`<image3>`。

仓库中的 `qwen_image_21_*_workflow_api.json` 是基于 ComfyUI 官方模板展平并适配后的 API 图，使用原生 `TextEncodeQwenImage21`、`KSampler`、VAE 和图片保存节点。两份静态 JSON 均显式包含 `LoraLoaderModelOnly`（节点 `100`），默认文件为 `Ameniwa.safetensors`（即双语 4000 步权重，2026-09-24 由 `AmeniwaQwen21Bilingual.safetensors` 改名；09-23 至 09-24 曾短暂改为 v3），强度为 0.8：文生图连接为 `UNETLoader → LoRA → KSampler`，图生图连接为 `UNETLoader → LoRA → QwenImage21Cache → KSampler`。

应用提交请求时，以用户选择的 LoRA 列表替换模板中的默认节点：未选 LoRA 则移除节点并直连基模，选择一个则覆盖文件和强度，选择多个则依次串联。参考图仍按实际上传数量动态插入。每次请求使用新图，避免可选节点污染下一次请求；不依赖 Easy-Use 或 Prompt-Control 节点。

- 采样采用 Euler / simple、CFG 1，默认 40 步，可选 20、25、40、50 步。
- 文生图默认 1024×1024。宽高范围 256–3072，按 32 对齐，总像素最多 3072×1536。
- 编辑默认按第一张图的比例创建采样 latent，参考图处理分辨率默认 1024。最终以 contain 方式还原原图尺寸，保留 alpha。关闭原图尺寸后使用指定宽高；明显改变画幅可能影响编辑位置。
- 图生图只有编辑连法：编码器接 `vae`，参考图同时编码成 reference latents 拼进序列，按像素对齐修改第一张图，采样经过 `QwenImage21Cache`。
- 每次生成使用随机 seed，设置中不提供固定种子。
- PNG 输出保留 RGBA。需要透明背景时在提示词中明确说明；官方建议使用 “This is an RGBA format image with transparency. … The image has an alpha channel and a transparent background.”。
- 宽高和原图尺寸开关同时保存到会话及消息。新增列使用启动时幂等 DDL，旧记录保持 NULL，重生成按工作流默认值处理，不借用当前其他会话的设置。
- 提示词扩写继续使用项目已有 Codex 连接，不额外部署官方 PE 文本模型。

## ComfyUI 与模型安装

ComfyUI 必须包含 `TextEncodeQwenImage21`、`QwenImage21Cache` 和 2.1 LoRA 映射。该环境从 0.31.1 更新至 0.37.0，源码版本 `b0f4b7b2`；更新前版本为 `fe4195f7`。同时安装对应 requirements，保留原有模型、输入、输出和自定义节点。

本次更新的 Python 包已安装到 `/root/.local`（宿主机持久化目录 `/opt/comfyui/storage/.local`），避免重建 ComfyUI 容器后丢失依赖。其中 comfy-kitchen 为 0.2.35、comfy-aimdo 为 0.5.5、前端包为 1.53.6、工作流模板为 0.11.66。PyAV 使用 17.1.0，并将 aiortc 更新到 1.15.0、aioice 更新到 0.10.2，以同时满足新版 ComfyUI 和 WebRTC 的依赖约束。

默认使用 Comfy-Org 的 INT8 ConvRot 权重：

| ComfyUI 目录 | 文件 |
|---|---|
| `models/diffusion_models` | `qwen_image_2.1_int8_convrot.safetensors` |
| `models/text_encoders` | `qwen3vl_8b_int8_convrot.safetensors` |
| `models/vae` | `qwen_image_2.1_vae_bf16.safetensors` |

`.env.example` 声明三个 `QWEN_IMAGE_21_*_FILE` 设置。现有部署可以运行 `python -B scripts/prepare_qwen_image_21_env.py` 补齐默认值；脚本不会输出凭据或覆盖已有设置。也可指定完整 BF16 模型文件名。

真实推理验证使用生产适配器：

```bash
python -B scripts/verify_qwen_image_21.py --output /tmp/qwen21_text.png
python -B scripts/verify_qwen_image_21.py --image /tmp/qwen21_text.png --prompt '保持主体不变，将蓝色杯子改成红色' --output /tmp/qwen21_edit.png
```

命令必须在拥有后端依赖且能够访问 `.env` 中 ComfyUI 地址的环境运行。

## AI Toolkit 训练

训练使用现有 `/opt/ai-toolkit` 的 Docker 配置，镜像 `ostris/aitoolkit:0.13.18`、源码 `31ddc70` 已包含 2.1。该模型的架构名为 **`qwen_image_2`**；文生图和编辑训练共用该架构。

画风训练配置为 `configs/training/ameniwa_qwen_image_21.yaml`：rank 16、batch 1、512/768 混合分辨率、学习率 5e-5、累计 4000 步，每 200 步保存。使用 ConvRot8、文本特征缓存和梯度检查点。16GB GPU 配置开启分层卸载，将一半 transformer 层及文本编码器卸载到 CPU。训练期间关闭内采样，通过 ComfyUI 独立验收检查点。

原始 Ameniwa 的图片和标注保持不变。独立副本使用固定随机种子划分 26 张训练图、5 张验证图，并记录 SHA-256；源内容变化时脚本拒绝覆盖已有副本。

```bash
python3 -B scripts/prepare_qwen_image_21_training.py /opt/ai-toolkit/datasets/ameniwa /opt/ai-toolkit/datasets/ameniwa_qwen21
```

以上为最初英文数据划分的历史命令。2026-09-22 已按用户要求删除该英文副本，并把双语数据集移到同名路径；当前双语训练配置见下文。

训练直接共享已安装的 ComfyUI 权重，通过 `MODELS_PATH` 指定只读目录，不重复下载三个大权重。处理器与模型配置仍从官方仓库读取并缓存在现有 Hugging Face 缓存中。

```bash
docker compose -f /opt/ai-toolkit/docker-compose.yml run --rm --no-deps --workdir /app/ai-toolkit --volume /opt/ai-draw:/source:ro --volume /opt/comfyui/storage-models/models:/qwen-models:ro --env MODELS_PATH=/qwen-models --entrypoint python ai-toolkit -u run.py /source/configs/training/ameniwa_qwen_image_21.yaml
```

训练需要独占足够 GPU 显存。AI Toolkit 按同名输出目录的检查点及优化器恢复，重启时检查日志中的恢复步数。现有标注用于画风训练；训练编辑行为时，应另行提供目标图、`control_path` 输入图与编辑指令的配对数据，不能把目标图简单复制为输入图。

`train.steps` 表示累计总步数。从已完成的 1200 步续训到 3000 步时，保持任务名和输出目录不变，将该值设为 3000，继续训练 1800 步。续训前已将整个 1200 步输出目录（含 `optimizer.pt` 和原配置）备份到 `/opt/ai-toolkit/backups/AmeniwaQwen21-step1200-20260921/`；备份保留初次验收的权重，供对照或恢复使用。

本次续训随后改为按时间结束：北京时间 2026-09-21 22:30（UTC 14:30）。先完成已启动的 3000 步任务，再由 `/opt/ai-toolkit/config/qwen21-run-until-20260921.py` 恢复该检查点继续训练；定时运行时将步数上限设为 10000，并通过 AI Toolkit 的 `end_step_hook` 在截止时间后的第一个完整训练步保存权重和优化器后退出。完成时会核对两者的步数一致，并记录在输出目录的 `deadline-20260921.json`。10000 是运行保护上限，实际目标以截止时间为准。

3000 步阶段已完成，权重元数据为 `step=3000, epoch=57`，优化器步数为 3000；另存完整输出至 `/opt/ai-toolkit/backups/AmeniwaQwen21-step3000-20260921/`，其中 `config.yaml` 保留该阶段的 3000 步配置。

## LoRA 验证与安装

AI Toolkit 使用 `diffusion_model.*` 的 ComfyUI 键名前缀。安装脚本校验基模标识 `qwen_image_2`、LoRA 张量名称、有限数值和非零训练投影，验证通过后原子安装，并输出 SHA-256。

```bash
python scripts/install_qwen_image_21_lora.py CHECKPOINT.safetensors /opt/comfyui/storage-models/models/loras/AmeniwaQwen21Bilingual.safetensors
```

脚本需在安装 PyTorch 与 safetensors 的环境中运行。文件检查并不等于画风验收：仍需实际运行文生图和图生图，检查未匹配 LoRA 键、与无 LoRA 的固定 seed 对照及留出图片上的效果。

当前状态（2026-09-24 起）：两种 Qwen 2.1 模式只登记了 `Ameniwa.safetensors`，标识和网页显示名称都是 **Ameniwa**。它就是双语 4000 步权重（SHA-256 `3f07795c…`），由 `AmeniwaQwen21Bilingual.safetensors` 改名而来，历史记录已一并迁移，详见文末“改名为 Ameniwa”一节。v3 的 5000 步、3000 步和最早的 `AmeniwaQwen21.safetensors` 已从 ComfyUI 删除，原件保留在 `/opt/ai-toolkit/output/` 各自的训练目录中，训练产物仍沿用原来的文件名。认证 LoRA 接口仅在登记文件实际存在时展示。其它风格权重安装后仍需在两种模式共用的 `lora_models` 中明确登记，不能直接列入其它架构的 LoRA。网页默认不选 LoRA，此时隐藏强度控件；选择 Ameniwa 时默认强度 0.8，选择框、0–1 强度滑条与末尾的 × 位于同一行，数值仅在滑条提示中显示。直接使用静态 JSON 时默认加载 `Ameniwa.safetensors`，强度 0.8。下文保留各阶段安装与验收的历史记录，其中出现的旧文件名均为当时的状态。

## 2026-09-21 验收记录

- AI Toolkit 完成 1200 步训练，最终权重元数据为 `step=1200, epoch=23`。第一次未启用分层卸载的尝试在训练前因显存不足退出；启用上述卸载配置后完整训练成功。
- 最终权重为 `/opt/ai-toolkit/output/AmeniwaQwen21/AmeniwaQwen21.safetensors`，已安装到 ComfyUI LoRA 目录；384 个张量均为有限数值，192 个上投影非零，实际推理日志确认 192 个权重补丁加载。
- SHA-256：`09f22e7c90c5ca034a46c9ab93fd5e220700c3bd517d282db4ee2bfb2e35d226`。
- 后端 108 项、前端 62 项测试通过；后续尺寸持久化与 Qwen 回归的 19 项定向测试通过。前端生产构建、Docker 构建和修改文件定向 lint 通过。全量 lint 保留原有 24 项问题，位于 helpers.ts 和 indexedDB.ts。
- 已完成无 LoRA 文生图、蓝杯改红杯编辑、固定 seed 42 的基模/LoRA 对照，以及带 LoRA 的三参考图生成；三图测试使用未参与训练的 `G1EGfU4aQAEOBrm.jpg` 作为编辑目标。PNG 输出保留 RGBA。
- 视觉检查确认 LoRA 的线条和平涂风格生效，但人物比例与训练集仍有差异；留出图编辑保留人物、服装与姿势，并将背景改为浅蓝色。该检查确认可用性，不代表画风的精确复刻。
- 线上桌面与 390px 手机界面覆盖统一入口、尺寸、LoRA 强度、取消设置、参考图增删、刷新恢复、跨模型暂存及历史重生成，无页面异常；生成请求在界面测试中拦截核对，真实推理另行验证。
- 实际认证 API 完成会话与历史尺寸持久化、空 LoRA/专用 LoRA 列表，以及带 LoRA 的文生图和图生图两轮完整生成。测试用户、会话与应用结果已清理。
- 已执行 `deploy: remote` 的完整等价流程，只刷新 `frontend-dist` 卷；后端与 PostgreSQL 健康，生产工作流接口已返回两条 Qwen 2.1 工作流。

## 2026-09-21 22:30 续训记录

- 先从 1200 步权重及优化器恢复到 3000 步，再按用户指定的北京时间 22:30 截止继续训练。
- 最终在北京时间 `22:30:00.837` 保存，元数据为 `step=3942, epoch=75`；优化器的步数同为 3942。定时训练容器正常退出，退出码为 0。
- 最终文件仍为 `/opt/ai-toolkit/output/AmeniwaQwen21/AmeniwaQwen21.safetensors`，已原子更新 ComfyUI 的同名 LoRA；384 个张量均为有限数值，192 个上投影非零。
- SHA-256：`c8e798d65b32eedf4087b9fd2321a78f05df0336b3be478a607e2f1dfa9f845d`。
- 1200 步及 3000 步的权重、优化器和配置分别保留在上述独立备份目录，原始数据与训练／验证划分未变。
- 新权重通过生产 provider 的真实文生图及图生图验证：强度 0.75、seed 42，文生图 40 步生成 768×1024 RGBA；编辑 20 步将蓝色上衣改为绿色，保留人物、红杯和构图，provider 原始结果为 448×576 RGBA。应用正常生成时的原尺寸恢复由 `GenerationEngine` 执行，本次脚本直接验证 provider。
- ComfyUI 推理日志确认加载 192 个 LoRA 权重补丁。验收图片为 `/opt/comfyui/storage-user/output/qwen21_until2230_text.png` 和 `qwen21_until2230_edit.png`；本轮提示词下的样图呈写实风格，该验证确认生成／编辑功能，不代表 Ameniwa 画风还原度提升。
- 北京时间 22:31 完成验收并恢复生图服务；线上状态接口返回可用，后端与 PostgreSQL 健康，ComfyUI 队列为空，临时测试用户已清理。此次只更新训练配置、记录和外置 LoRA 权重，未修改应用代码。

## 2026-09-21 补齐至 4000 步

- 按用户要求，从 3942 步权重和优化器恢复，再训练 58 步；最终元数据为 `step=4000, epoch=76`，优化器步数为 4000，训练容器退出码为 0。
- 3942 步完整输出已另存至 `/opt/ai-toolkit/backups/AmeniwaQwen21-step3942-20260921/`，1200 步及 3000 步备份继续保留。`deadline-20260921.json` 记录的是此前 3942 步的定时停止，最新进度以权重元数据和优化器为准。
- 4000 步权重通过 384 个有限张量、192 个非零上投影校验，并原子更新同名 ComfyUI LoRA。SHA-256：`63f005f55c4197ad1ded5d70c52a51e10cc57075b9ab2679074d1650ca283809`。
- 使用强度 0.75、seed 42、40 步采样完成真实文生图验证，输出 768×1024 RGBA；验收图片为 `/opt/comfyui/storage-user/output/qwen21_step4000_text.png`。验证后已恢复生图服务。

## 2026-09-21 LoRA 画风效果排查

用户使用 `一个女孩`、`qwen_image_21_t2i`、`<lora:AmeniwaQwen21:0.8>` 后仍得到写实图片。核对该请求的真实 ComfyUI history：

- LoRA 节点为 `LoraLoaderModelOnly`，文件为 `AmeniwaQwen21.safetensors`，强度为 0.8；`KSampler.model` 实际连接该节点，而不是直接连接基模。日志记录 192 个权重补丁。
- 安装文件与 4000 步训练产物的 SHA-256 相同，未使用旧权重。
- 固定用户请求的 seed `6304978276543807176`、1024×1024、40 步、Euler/simple、CFG 1，仅移除 LoRA 后再次生成。与原图的 RGB 平均绝对差为 28.572/255；视觉上人物姿势和轮廓发生变化，但两张均为写实风格。该统计说明输出不同，不是画风相似度评分。
- 对照文件为 `/opt/comfyui/storage-user/output/qwen21_lora_probe_base_00001_.png`（无 LoRA）及 `ai_draw_qwen21_00009_.png`（原请求、LoRA 0.8）。
- 再使用 `一个女孩，二次元平涂插画，粗黑色轮廓线，简洁的块面阴影，白色背景。` 做同 seed 的开关对照，两者均能生成黑白插画；LoRA 改变头脸比例和头发，但仍未稳定复现训练图画风。结果为 `qwen21_style_probe_base_00001_.png` 与 `qwen21_style_probe_lora08_00001_.png`，同在上述输出目录。

结论：当前请求的 LoRA 已加载且影响了输出，没有发现参数丢失或模型接线错误；4000 步权重在本次短中文提示词测试中的目标画风表现未达预期。此前训练完成、张量校验及生图成功只能作为训练执行和生成链路的验收，不能当作画风学习达标的证明。加入画风描述本身也会影响基模，不应将这一效果全部归于 LoRA。

抽查训练标注使用 `1girl, solo, ...` 一类英文标签；配置没有设置独立风格触发词。标注、提示词分布、训练配置与样本量均是后续应对照的因素，尚不能把原因单独归于某一项，或认定增加步数就能修复。后续应先比较保留的不同步数权重在统一验证集上的表现，再决定是否调整标注、触发词或训练参数。此次没有修改生成工作流或重新训练，服务保持正常。

## 静态模板显式 LoRA 节点补齐

- 上述排查时，LoRA 由应用后端动态添加，两个静态 JSON 自身没有 LoRA 节点。现已在两份文件中加入并接通节点 `100`，默认 `AmeniwaQwen21.safetensors`、强度 0.8；应用后端按请求替换或移除模板 LoRA。
- 10 项 Qwen 回归测试通过，覆盖模板模型接线、未选 LoRA 时移除默认节点、单个 LoRA 覆盖及多个 LoRA 串联。已执行 `deploy: remote` 等价流程，只刷新 `frontend-dist` 卷。
- 部署后的真实认证 API 文生图、图生图均成功。ComfyUI 执行记录各只有一个 LoRA 节点，强度均为请求指定的 0.75，确认覆盖了模板默认 0.8 且没有重复加载；图生图顺序为 LoRA 后接缓存再接采样器。服务健康，临时测试用户已清理。
- 此次变更使静态模板本身也包含 LoRA，没有更改训练权重，不能据此认定目标画风已经训练达标。

## 4000 步权重的提示词与原生推理复核

用户确认“仍然一样”指生成画风。再次核对工作区与部署容器，两份 JSON 的 SHA-256 完全相同且都包含节点 `100`；修改前后的两次 `一个女孩` 请求除 seed 外，整个执行图相同。因此补齐静态节点不会改变此前网页已动态加载 LoRA 时的实际推理行为，不能当作画风问题的修复。

使用 seed `6304978276543807176`、1024×1024、40 步、CFG 1、LoRA 0.8 补充对照：

| 提示词／对照 | 观察结果 |
|---|---|
| `一个女孩`，分别使用 1200、3000、4000 步权重 | 三者均偏写实，回退检查点没有解决该提示词下的画风问题。 |
| `1girl, solo, black_hair, twintails, school_uniform, white_background`，无 LoRA／4000 步 LoRA | 基模为细腻渐变动漫插画；LoRA 输出明显转为接近训练图的粗线、平涂、块面阴影。 |
| `1girl`，无 LoRA／4000 步 LoRA | 同样能观察到从常规渐变动漫插画到粗线平涂的变化。 |
| `一个二次元女孩`，4000 步 LoRA | 中文也能生成明显的粗线平涂效果；并非只能使用英文。 |

另外使用 AI Toolkit 自身的 `QwenImage2Model`、原生采样器和 LoRA 前向分支做仅推理验证，192 个 LoRA 模块全部加载，`Missing keys: []`。原生结果同样是 `一个女孩` 偏照片、上述英文标签呈粗线平涂，与 ComfyUI 的定性表现一致；没有发现仅出现在 ComfyUI 中的风格失效。两端采样实现存在差别，此处不宣称逐像素一致。

这组证据将结论收窄为：4000 步权重确实学到了可见的动漫画风变化，但效果依赖提示词的动漫语义，尚不能从普通简短描述稳定覆盖基模的写实倾向。先前“未达到预期”的结论适用于 `一个女孩`，不等于权重完全没有学到画风。当前可直接尝试 `一个二次元女孩` 配合 `<lora:AmeniwaQwen21:0.8>`；这是已经实测的使用方式，不是对所有提示词和 seed 的质量保证。要让普通短描述也稳定获得该风格，仍需后续训练与触发机制验证。

复现资料：

- ComfyUI 对照图片位于 `/opt/comfyui/storage-user/output/`，前缀为 `qwen21_checkpoint_probe_` 和 `qwen21_minimal_probe_`；对应日志为 `qwen21-checkpoint-probe.log`、`qwen21-minimal-prompt-probe.log`。
- 原生验证脚本为 `/opt/ai-toolkit/config/qwen21-native-probe.py`，结果位于 `/opt/ai-toolkit/output/AmeniwaQwen21NativeProbe/`，容器 `ai-draw-qwen21-native-probe` 正常退出。
- 本次没有增加训练步数或替换已安装的 4000 步权重，SHA-256 仍为 `63f005f55c4197ad1ded5d70c52a51e10cc57075b9ab2679074d1650ca283809`。原生验证结束后已恢复 ComfyUI 和生图服务。

## 2026-09-22 双语新训练（4000 步已完成）

本轮按用户确认的参数从原始 Qwen-Image-2.1 基模重新训练，不加载旧 `AmeniwaQwen21` 的 LoRA 或优化器。AI Toolkit Web UI 创建并启动的真实任务为 `AmeniwaQwen21Bilingual`，任务 ID 为 `db9cb8c8-0cf9-456a-94d1-d8d11738aef8`。目标是改善普通中文描述下的画风表现，最终效果仍需固定提示词、seed 和留出图对照，不能以 loss 或完成步数代替质量验收。

### 数据与参数

- 数据副本现为 `/opt/ai-toolkit/datasets/ameniwa_qwen21/`：2026-09-22 删除原英文副本后，由 `ameniwa_qwen21_bilingual` 原样改名。原始英文标签后空一行，追加与图片内容对应的中文自然语言段落。原图与标注内容保持不变；训练配置和 AI Toolkit UI 任务中的数据集路径已同步，已完成训练的输出配置快照保留当时的路径。
- 固定划分种子 `20260921`，26 张训练、5 张留出。`manifest.json` 记录源文件和副本哈希；`validation.json` 记录 31 份标注经本模型原生 tokenizer 完整编码／解码校验通过，长度 204–325 tokens。没有复制旧 latent 或文本缓存。
- 配置：[`configs/training/ameniwa_qwen_image_21_bilingual.yaml`](../configs/training/ameniwa_qwen_image_21_bilingual.yaml)。UI 实际执行配置另存于输出目录的 `.job_config.json`。
- `type: diffusion_trainer`、`arch: qwen_image_2`，从 0 开始训练至 **4000 步**；LoRA rank/alpha **16/16**，batch **1**，梯度累积 **1**；文本编码器冻结。
- 训练分辨率 **[512, 768, 1024]**，按原图比例分桶；日志确认三个档位均参与，包括 `1024×1024`、`768×1344` 等 1024 档桶。
- **Prodigy**（`optimizer: prodigyopt`），基准学习率 **1.0**、constant 调度；`d_coef=1.0`、`weight_decay=0.01`、`use_bias_correction=true`、`safeguard_warmup=true`。日志的有效学习率是 Prodigy 自适应后的值，启动时可显示 `1e-6`，不代表配置退回 AdamW。
- FlowMatch、`timestep_type: shift`；BF16、模型和文本编码器 ConvRot8；梯度检查点，transformer 50%／文本编码器 100% CPU 分层卸载；latent 与文本特征缓存。文本特征缓存完成后，Toolkit 自动卸载文本编码器。
- 标注丢弃率 **0.05**，不打乱标签，不新增触发词。
- 开始前、每 **400** 步及结束时预览：**1024×1024**、40 步、CFG **1**、LoRA **0.8**、seed **42**，不递增 seed。五条提示词包含 `一个女孩`、`一个二次元女孩`、原英文标签及中英文自然语言验证项。
- 每 **200** 步保存，保留 **20** 个检查点；UI loss 每步记录，关闭 WandB。

### 页面与运行记录

AI Toolkit 在服务器 `8675` 端口，任务路径为 `/jobs/db9cb8c8-0cf9-456a-94d1-d8d11738aef8`。本机不直接连接服务器端口时，可运行：

```bash
ssh -N -L 18675:127.0.0.1:8675 nekocon-server
```

然后打开 `http://localhost:18675/jobs/db9cb8c8-0cf9-456a-94d1-d8d11738aef8`，使用现有 AI Toolkit 登录密码；不在文档中记录密码。

- 启动前已通过 SQLite backup API 备份任务库，执行 WAL checkpoint，并在重建 UI 容器后确认原有 3 个任务完整保留；备份为 `/opt/ai-toolkit/config/aitk-ui-before-bilingual-20260921.sqlite`。
- AI Toolkit Compose 增加三个已有 Qwen 权重文件的只读挂载，保留原模型目录与 Hugging Face 缓存挂载。
- 原生训练日志确认 `Using Prodigy optimizer`、`Using lr 1`、192 个图像模型 LoRA 模块；第一组 5 张预览实际尺寸均为 1024×1024，UI samples 接口能读取。
- 启动验收时任务已超过 78 步，UI `loss/loss` 曲线有 77 个有限数值点；见 `/opt/ai-toolkit/output/AmeniwaQwen21Bilingual/start-verification.json`。该数字是启动验收快照，实时进度以任务页面为准。
- 首个 `AmeniwaQwen21Bilingual_000000200.safetensors` 已实际保存，元数据为 `step=200, epoch=2`；384 个张量均有限，192 个上投影非零，确认 LoRA 已更新。优化器保存的基准 `lr=1.0`、自适应 `d≈2.359e-5`，bias correction、safeguard warmup 与 weight decay 均符合配置；见同目录 `first-checkpoint-verification.json`。此检查确认训练与保存有效，不代表 4000 步已完成或画风已达标。
- 输出目录：`/opt/ai-toolkit/output/AmeniwaQwen21Bilingual/`；`log.txt`、`loss_log.db`、`samples/` 分别保存日志、曲线和预览。
- 训练期间独占 GPU，ComfyUI 和应用生图服务暂停。独立容器 `ai-draw-qwen21-bilingual-watch` 每 30 秒检查任务，设计为在任务结束、没有其他排队／运行任务且 GPU 已释放后启动 ComfyUI，再恢复应用服务；实际恢复曾因下述旧 Docker 网络引用而失败，现已修复。状态写入输出目录 `training-service-watch.json`；该程序不安装新权重。
- 双语准备脚本的 3 项定向测试通过；服务恢复程序的 4 个生命周期检查通过。已完成 `deploy: remote` 等价部署，只刷新 `frontend-dist`；应用与数据库健康，生成状态在训练期间有意设为不可用。

### 完成验收与效果

- UI 状态为 `completed`、`step=4000`、`Training completed`。最终文件为 `/opt/ai-toolkit/output/AmeniwaQwen21Bilingual/AmeniwaQwen21Bilingual.safetensors`，元数据 `step=4000, epoch=51`；文件于北京时间 2026-09-22 07:21:56 保存，末组预览在约 07:24:43 写完。
- SHA-256：`3f07795cb2f9f96515c89a0e7520eb27e8d47f1374caae72b2dd32bc24b65ec4`。384 个张量均为有限数值，192 个上投影非零；Prodigy 保存状态 `k=4000`、`lr=1.0`、`d≈0.00016159`，3999 个已记录 loss 点均为有限数值。
- 共 20 份 LoRA 文件（200–3800 步的 19 个阶段文件，加上 4000 步最终文件）；共 55 张预览（0–4000 步，每 400 步一组 5 张）。
- 固定 seed 42、CFG 1、40 步、LoRA 0.8，对照训练前和 4000 步样图：`一个女孩` 前后均为写实照片，人物外观发生变化，但未转为目标插画风格；`一个二次元女孩` 与 `1girl, solo, black_hair, twintails, school_uniform, white_background` 从常规渐变动漫图转为粗线和平涂风格。对应样图位于 `samples/`，编号后缀 `_0`、`_1`、`_2` 分别对应这三条提示词。
- 后续阶段复核发现重要例外：同样参数下，**3200 步的 `一个女孩` 已为粗线平涂插画**，而 3600、4000 步又为照片。原图为 `samples/1790031103577__000003200_0.jpg`，已用 SHA-256 确认图片对应关系；已有 `AmeniwaQwen21Bilingual_000003200.safetensors` 可作为下一步候选。首尾对照不能推成所有中间阶段均写实；该候选仍待生产链路复现及跨 seed／提示词验证，尚未替换线上版本。逐图对应和最小对照方案见 [`qwen_image_21_upstream_review.md`](qwen_image_21_upstream_review.md#2026-09-22已有阶段预览复核3200-步出现短句风格成功样本)。
- 新 LoRA 对动漫提示词产生了明显画风影响，但最终 4000 步仍未满足普通短中文稳定呈现目标画风的要求；3200 步的单个成功样本也不足以完成这一验收。新权重的 ComfyUI 编辑／留出图验收仍未进行；首次完成验收时未替换线上版本，后续独立上线情况见下文。
- 首次完成验收时，线上仅提供旧 `AmeniwaQwen21.safetensors`，复核 SHA-256 为 `63f005f55c4197ad1ded5d70c52a51e10cc57075b9ab2679074d1650ca283809`。后续已将双语新版作为独立选项上线，见下文雨衣提示词复核；旧文件继续保留。

### 绘图服务恢复修复

2026-09-22 检查时发现训练已结束，但 ComfyUI 仍停止，恢复程序持续重试。原因是部署重建了 `ai-draw_ai-draw-network`，停止中的 ComfyUI 保留旧网络 ID，`docker start comfyui` 报 `network ... not found`。训练和权重不受影响。

停止恢复程序后，仅解除 ComfyUI 对该失效网络的引用，再连接现有同名网络并保留 `comfyui` 别名；其它网络、挂载、模型和数据均保留。随后重新运行恢复程序，它成功启动 ComfyUI、恢复应用服务并以退出码 0 结束。北京时间 **12:49:07** 的状态记录为 `service_resumed=true`、`weights_installed=false`；生产状态接口返回 `available=true`，后端能访问 ComfyUI 0.37.0，临时恢复用户剩余 0 个。

后续若在 ComfyUI 停止时执行会重建网络的完整部署，应在启动 ComfyUI 前核对其网络 ID 与当前同名网络一致；恢复程序的模拟生命周期检查没有覆盖 Docker 网络被重建的场景，不能代替该实际检查。

### 雨衣提示词的版本／强度差异与新版上线

用户比较 `一个穿黄色雨衣的女孩，站在公交站旁，手持一把蓝色雨伞。` 在网页与 Toolkit 的结果。检查最近三次匹配请求，应用历史和 ComfyUI 执行图一致：

| 项目 | 网页这三次请求 | Toolkit 本轮 4000 步预览 |
|---|---|---|
| LoRA | `AmeniwaQwen21.safetensors`，旧版 | `AmeniwaQwen21Bilingual`，双语新版 |
| 实际强度 | **0.0** | **0.8** |
| seed | 随机且每次不同 | 42 |
| 尺寸／步数／CFG | 1024×1024／40／1 | 1024×1024／40／1 |
| 参考图 | 无 | 无 |

对应网页 ComfyUI prompt ID 为 `f9cb0b6a-b172-4308-9ee0-ab56c149ec2a`、`33397261-67b8-46d1-8205-9e2144a05442`、`48d3e71f-213e-4359-a2a0-779b77554263`。三次 `strength_model=0.0` 意味着没有应用 LoRA 的权重变化；这个证据只对应这三次请求，不否认用户在其它请求上试过 0.8 或 1。不能用前述短句泛化假设直接解释这组未对齐版本和强度的对照。

- 已验证并原子安装双语最终权重到 `/opt/comfyui/storage-models/models/loras/AmeniwaQwen21Bilingual.safetensors`，SHA-256 与 Toolkit 最终文件相同，为 `3f07795cb2f9f96515c89a0e7520eb27e8d47f1374caae72b2dd32bc24b65ec4`。
- 两个 Qwen 工作流共用的 LoRA 列表现在分别显示 **Ameniwa（旧版 · 4000 步）** 和 **Ameniwa（双语新版 · 4000 步）**。选择新模型时默认强度 0.8；已保存的用户配置和历史参数不被静默改写。
- 部署后通过生产 `QwenImage21Provider`，使用原句、新版 0.8、seed 42、1024×1024、40 步、CFG 1、Euler/simple 真实生成成功。ComfyUI prompt ID 为 `2f05cdaa-caac-4e8c-b740-60ffd3844850`，执行图的模型明确连接新版 LoRA 节点。
- 结果为 `/opt/comfyui/storage-user/output/qwen21_bilingual_raincoat_verified.png`（1024×1024 RGBA）。视觉确认黄色雨衣、蓝伞和公交站场景呈粗线平涂二次元风格，与 Toolkit 第 4 条提示词的 4000 步样图画风及主要构图接近，但不是逐像素相同。
- 使用 Docker 应用运行环境通过 Qwen／LoRA catalog 共 18 项测试；宿主机 Python 缺少 Pillow、PyYAML，未将宿主机导入失败误记为应用测试失败。已执行完整 `deploy: remote` 等价流程，仅刷新 `frontend-dist`，认证列表接口确认文生图／编辑均返回两版 LoRA，默认强度均为 0.8。
- 实测后恢复绘图服务并删除本轮验证容器。使用新版时，刷新网页，在生成设置选择双语新版和所需强度，再发起新一轮生成；历史重生成仍沿用该条历史保存的版本与强度。

### LoRA 列表与设置布局收敛

- 按用户要求，Qwen 2.1 的文生图／编辑列表仅保留双语 4000 步版本，显示名称统一为 **Ameniwa**。底层文件和已保存的 `AmeniwaQwen21Bilingual` 标识保持不变；两份静态模板默认文件同步为双语版。旧版取消应用登记，训练产物与备份保留。
- 选择框、强度滑块与末尾的 × 移除按钮保持同一行；强度数值仅在滑条提示中显示，保留两位小数，不再占用独立数值列。没有其它可添加模型时隐藏“添加 LoRA”按钮。
- Qwen／LoRA catalog 共 18 项后端测试通过；Node 22 Docker 环境中的 62 项前端测试、前端生产构建和修改组件的定向 lint 通过。宿主机 Node 20 不支持测试脚本所需的 `--experimental-strip-types`，因此测试使用与 Dockerfile 一致的 Node 22 环境。
- 已执行完整 `deploy: remote` 等价流程，仅刷新 `frontend-dist` 卷，后端／数据库健康，绘图服务正常。部署后真实认证 API 确认两个 Qwen 工作流均仅返回 `AmeniwaQwen21Bilingual`／`Ameniwa`，默认强度 0.8。
- 本地及部署后的浏览器检查覆盖桌面 1440px、窄屏 390px／320px，以及编辑模式：控件同排、无横向溢出，强度 0／1 边界与 0.75 保存请求、重新打开、移除及取消均符合预期，无页面异常。浏览器检查使用隔离的会话接口模拟，不改写真实用户设置或执行生成；认证列表检查使用的临时用户已清理。

## Qwen-Image-2.1 工作流（官方模板 + LoRA）

官方模板把整条管线收进子图，LoRA 需要接入的 MODEL 连线被折叠在里面。`scripts/build_qwen_image_21_workflows.py` 生成官方注释所说的“展开子图”形态，并在扩散模型与采样器之间接入 `LoraLoaderModelOnly`。同一套节点同时输出 ComfyUI 界面工作流和应用使用的 API 模板，两边由脚本保持一致：

| 文件 | 连线 |
|---|---|
| `/opt/comfyui/storage-user/workflows/image_qwen_image_2_1_t2i.json` | `UNETLoader → LoraLoaderModelOnly → KSampler` |
| `/opt/comfyui/storage-user/workflows/image_qwen_image_2_1_image_edit.json` | `UNETLoader → LoraLoaderModelOnly → QwenImage21Cache → KSampler` |
| `configs/workflows/qwen_image_21_t2i_workflow_api.json` | 同上，API 形态，应用使用 |
| `configs/workflows/qwen_image_21_i2i_workflow_api.json` | 同上，API 形态，应用使用 |

- 节点、模型文件、Euler/simple、CFG 1、`TextEncodeQwenImage21`、`QwenImage21Cache`、`ComfySwitchNode`（`custom_size`）、`ResolutionSelector` 与 `SaveImageAdvanced` 均与官方 t2i、image edit 模板一致。步数取官方管线的 40（官方模板起始值为 25），seed 固定 42，便于与应用结果对照。
- LoRA 节点默认 `AmeniwaQwen21Bilingual.safetensors`、强度 0.8；强度 0 或 Ctrl+B 旁路即为不加载，复制该节点可串联多个 LoRA。LoRA 只打模型权重，不改文本编码器。
- 编辑工作流默认加载官方示例图 `portrait_model_denim.png`、`clothing_light_blue_denim_shirt.png`（已下载到 `/opt/comfyui/storage-user/input/`），提示词用 `<image1>`、`<image2>` 指代；再连一条 IMAGE 到编码器空槽即可增加参考图。
- API 模板保留应用契约所需的节点 ID 与标题（`1` 基模、`100` LoRA、`4` 编码器、`5` 空 latent、`6` 采样器、`8` 保存、`9` 编辑缓存），并去掉三个界面便利节点：分辨率选择器（请求直接给宽高）、`ComfySwitchNode`（后端自行决定采样 latent）和示例 `LoadImage`（参考图按请求上传插入）。
- 重新生成：`python3 -B scripts/build_qwen_image_21_workflows.py`（默认同时写入 ComfyUI 工作流目录和 `configs/workflows/`，会覆盖同名文件）。

### 2026-09-22 验收

- 两份工作流在真实 ComfyUI 界面（0.37.0，`b0f4b7b2`）从工作流侧栏打开，无缺失节点、无报错提示；由界面直接运行，排队的 API 图都包含 LoRA 节点，且分别接到 `KSampler`、`QwenImage21Cache`。
- 文生图 prompt `bb630364-1a06-476d-ba79-44b353fe48f7` 输出 `Qwen_image_2.1_lora_00001.png`（1024×1024 RGBA）；提示词为雨衣句，画风为粗线平涂二次元。
- 同一执行图仅把强度改为 0 复跑（prompt `656ca9bb-6023-43e9-b6d7-25ebfb6aaa70`，输出 `Qwen_image_2.1_nolora_00001.png`）：相同 seed 下 99.8% 像素变化、RGB 平均绝对差 75.68，结果为写实照片。ComfyUI 日志相应显示 `192 patches attached` 与 `0 patches attached`。这证明 LoRA 在该工作流中真实生效。
- 编辑工作流 prompt `c049b395-b580-4989-8765-86d7cbf14573` 输出 `Qwen_image_2.1_edit_lora_00001.png`，按官方示例把 `<image2>` 的牛仔衬衫穿到 `<image1>` 的人物身上，保留脸部、姿势与背景。该例在 LoRA 0.8 下仍为写实照片风格：编辑指令与参考图主导画面，不能据此认为画风 LoRA 对编辑无效或已达标。
- 两份文件随后由界面自身保存一次，重新加载后 `graphToPrompt()` 与上述已验证运行的 API 图逐节点一致。
- 上述验收时文件名带 `_lora` 后缀、保存前缀为 `Qwen_image_2.1_lora`；当天稍后按用户要求去掉后缀，输出前缀改为官方的 `Qwen_image_2.1`／`Qwen_image_2.1_edit`，图形本身未变。

### 2026-09-22 应用模板替换

按用户要求，用上述工作流替换应用的 `qwen_image_21_t2i` 与 `qwen_image_21_i2i`。逐节点比对后，实际差异只有两处：

| 项目 | 替换前 | 替换后 |
|---|---|---|
| 保存节点 | `SaveImage` | `SaveImageAdvanced`（`png` / `8-bit` / `sRGB`，与官方模板一致） |
| 模板占位提示词 | `一只橘猫坐在窗边`／`把背景改为海边日落` | 与界面工作流相同的雨衣句／换装指令（每次请求都会覆盖） |

其余节点、连线、模型文件、Euler/simple、CFG 1、40 步默认、LoRA 节点 `100` 与参考图动态插入逻辑均与替换前相同——应用原本就是官方图的展平版，所以这次替换不改变生成行为，只统一了保存节点和生成来源。

- 111 项后端测试通过（含模板模型链、LoRA 覆盖／串联、参考图绑定），两份 API 模板对照 ComfyUI 实际节点定义校验通过。
- 已执行完整 `deploy: remote` 等价流程，仅删除 `frontend-dist`；容器内模板 SHA-256 与工作区一致（`6c3c47b2…`／`6c555e53…`）。
- 部署后用真实认证 API 生成两轮：文生图与图生图各 512×512 RGBA，LoRA 列表只返回 `AmeniwaQwen21Bilingual`。ComfyUI 执行图确认保存节点为 `SaveImageAdvanced`、格式 `png/8-bit/sRGB`，LoRA 为 `AmeniwaQwen21Bilingual.safetensors` 强度 0.8，文生图采样器模型接 LoRA、图生图接 `QwenImage21Cache`。临时用户与会话已清理。
- 部署前暂停、部署后恢复生图服务，线上状态接口正常。

### 2026-09-22 与官方模板的同 seed 像素对照

此前只对比了节点结构，没有跑官方模板本体。补做真实对照：把官方 t2i、image edit 模板原样载入 ComfyUI，仅把提示词、seed 42、40 步、CFG 1、`resolution` 1024（编辑）和 `custom_size=false` 调成与本项目一致，再与本项目工作流在 LoRA 强度 0（等于官方图没有 LoRA 节点的状态）下的输出逐像素比较：

| 对照（同 seed、同参数） | 结果 |
|---|---|
| 官方 t2i 模板连跑两次 | 逐像素相同，确认管线本身确定 |
| 官方 t2i 模板 vs 界面工作流（LoRA 0） | 逐像素相同，最大差 0 |
| 官方 t2i 模板 vs 应用模板（未选 LoRA，经 `attach_qwen_loras` 生成执行图） | 逐像素相同，最大差 0 |
| 官方 image edit 模板 vs 界面编辑工作流（LoRA 0） | 逐像素相同，输出同为 896×1152 |
| 同图开启 LoRA 0.8 | 文生图 99.8% 像素变化；编辑 10.09% 像素变化 |

- 对照图片位于 `/opt/comfyui/storage-user/output/`：`Qwen_image_2.1_officialtpl_00001.png`、`Qwen_image_2.1_officialtpl2_00001.png`、`Qwen_image_2.1_nolora_00001.png`、`ai_draw_qwen21_officialcmp_00001.png`、`Qwen_image_2.1_edit_officialtpl_00001.png`、`Qwen_image_2.1_edit_nolora_00001.png`。
- PNG 会嵌入工作流与提示词元数据，因此文件 SHA-256 不同而像素相同；比较基于解码后的 RGBA 像素。
- 官方模板只在本次对照中临时放入 ComfyUI 工作流目录，比较后已删除。
- 该结论适用于上述参数组合，不是对所有提示词、尺寸与步数的普遍证明；LoRA 开启后输出与官方基线不同是预期行为。

### 2026-09-22 参考图用法（编辑／风格参考）与固定种子

起因：用户在 ComfyUI 中把草稿和上色参考接到**文生图**图的编码器（不接 `vae`、空白画布）得到按草稿上色的结果，而 aidraw 只要有参考图就走编辑连法（接 `vae`、经 `QwenImage21Cache`），常整张复制第二张参考图。`TextEncodeQwenImage21` 接 `vae` 时参考图变成 reference latents 且不保留视觉 token，不接时只走视觉塔。

- 新增 `qwen_reference_mode`（仅图生图，默认 `edit`，行为与原先相同）和 `qwen_seed`（两种 Qwen 方式共用，默认随机）。前端新增通用参数类型 `seed`，参数可带 `description` 作为设置说明。
- 用用户那组草稿与参考图（应用上传副本）、原提示词 `<image1>是草稿，生成<image2>一样的上色风格`，经生产 provider 真实生成，40 步、参考分辨率 1024、原图尺寸，输出均为 1120×960 RGBA：
  - 风格参考 × seed 1050620799108459165、8488373540190178648、20260922（此前在编辑模式下全部复制 image2）：三张都是草稿的猫耳水手服少女，采用 image2 的粉发绿眼配色，没有复制 image2；其中 8488… 画成了三人并排的设定图，构图仍随 seed 变化。执行图确认无 `vae` 输入、无 `QwenImage21Cache`，采样模型直连 `UNETLoader`。
  - 编辑 × seed 1050620799108459165：再次复制 image2，与线上历史一致。
- 风格参考采用 image2 的配色与人物特征，但线条质感不完全等同 image2 的粗线平涂；这是三张样例的观察，不代表所有提示词。
- 113 项后端、75 项前端测试，修改文件定向 lint 和生产构建通过；完整 `deploy: remote` 后元数据接口返回两个新参数，部署的 `SettingsModal` 资源包含种子输入框。

### 2026-09-23 移除风格参考，只保留编辑

- 按用户要求删除 `qwen_reference_mode` 及其后端分支，图生图恢复为单一编辑连法；`qwen_seed` 保留。
- 上线期间有 1 条消息（`msg-8709469f-cd83-4ec4-abab-38774fa8aa38`）和 1 个会话配置保存了该选项。历史数据不改写：前端只发送元数据中存在的选项，后端 `qwen_options` 忽略未知键，重新生成时按编辑执行。
- 上面三张风格参考样例只作调查记录；接不接 `vae` 对“按草稿上色”类指令的影响仍然成立，但应用不再提供不接 `vae` 的方式。
- 112 项后端、75 项前端测试，修改文件定向 lint 和生产构建通过；完整 `deploy: remote` 后元数据只剩 `qwen_steps`、`qwen_reference_resolution`（仅图生图）和 `qwen_seed`。部署后用生产 provider 带旧的 `qwen_reference_mode: reference` 实际生成一次，执行图接 `vae`、经过 `QwenImage21Cache`、seed 为 42。

### 2026-09-23 移除随机种子，生成数量只保留滑条

- 按用户要求删除 `qwen_seed`：包括配置项、前端 `seed` 参数类型及其通用选项辅助函数、后端种子校验，以及仅供种子使用的 `ProviderInput.index`。每次生成恢复为随机 seed。上线期间有 8 条消息保存了该字段，但值都为空，没有已固定的结果受影响；旧字段与 `qwen_reference_mode` 一样，由前端过滤、后端忽略。
- 生成设置中的“生成数量”去掉右侧数字框，只保留原有刻度的滑条。滑条沿用原来的行结构，与宽度、高度滑条左对齐，并占满原数字框的位置；拖动或悬停时提示气泡显示当前值。当前 antd 版本不会把 `aria-label` 写到滑块上，因此改用 `ariaLabelForHandle`，让滑块保留“生成数量”的可访问名称。
- 111 项后端、75 项前端测试，修改文件定向 lint 与生产构建通过。浏览器检查使用 Qwen 与 Z-Image，在 1440、390、320 宽度下确认：没有种子字段和数字框，滑条无横向溢出，键盘可调到最小值和最大值，保存后重新打开值不变，生成请求携带所选数量，且不包含旧的 `qwen_seed`、`qwen_reference_mode`。同一检查在部署后的线上静态资源上也通过；检查使用模拟会话接口，没有改动真实用户数据。

### 2026-09-23 ComfyUI 中查看 aidraw 的 API 工作流

- 按 ComfyUI 工作流目录已有的约定（`<name>_workflow_api.json` 保存仓库同名 API 文件的界面格式），新增 `/opt/comfyui/storage-user/workflows/qwen_image_21_t2i_workflow_api.json` 与 `qwen_image_21_i2i_workflow_api.json`。
- 生成方式：在真实 ComfyUI 界面（前端 1.53.6）用 `loadApiJson` 导入仓库中的两份 API 模板，保留原节点编号与标题，由界面自动排版；各加一个“aidraw 说明”Markdown 节点，写明 aidraw 每次请求覆盖和插入的内容；最后由界面自身保存。注意 `loadApiJson` 会异步重载图，必须等节点和连线稳定后再改图，否则节点编号会整体后移、连线丢失（首次尝试即因此产生坏文件，已删除后重做）。
- 验证：刷新后从侧栏打开，无缺失节点、弹窗或页面错误；`graphToPrompt()` 结果与 `configs/workflows/` 中对应文件逐节点一致（编号、类型、标题、全部输入）。说明节点不进入执行图。
- 这两份是仓库模板的快照，仅供查看。aidraw 不读取它们，在 ComfyUI 中修改不会影响网页；仓库模板更新后需重新导入。

### 2026-09-23 恢复“参考图用法”

- 按用户要求把 `qwen_reference_mode` 加回图生图设置，连法与 2026-09-22 版本相同；随机种子不恢复。设置项说明文字由参数的 `description` 字段提供。
- 113 项后端、75 项前端测试，修改文件定向 lint 与生产构建通过；本地和线上界面检查（1440、390 宽度）确认可选择“风格参考”、保存后随生成请求发送。
- 完整 `deploy: remote` 后，用生产 provider、同一张草稿、Ameniwa 0.8 各跑一次：编辑方式的编码器接 `vae`、采样经过缓存；风格参考方式不接 `vae`、无缓存节点、采样器直接接 LoRA 节点 100；两者画布都跟随草稿比例。
- ComfyUI 中 `qwen_image_21_i2i_workflow_api.json` 的说明节点已同步写明两种连法。

### 2026-09-23 彻底移除风格参考

- 用户用同一张线稿草稿、同一段提示词（保持姿势构图、重绘为粗线平涂成品、加白色猫耳和深蓝连体泳衣）、Ameniwa 0.8 实测：编辑方式（13:18）保持了草稿的姿势（一手叉腰）、取景（猫耳到膝盖）、短发和人物位置，并换成泳衣；两次风格参考（13:45、13:47）姿势和取景都变了（半身、胸像），头发变长、多出眼镜和尾巴，而且仍穿草稿里的水手服，忽略了泳衣要求。
- 原因：风格参考下草稿只进入 Qwen3-VL 视觉部分，扩散模型得到的是“猫耳、水手服、短发女孩”这类语义信息，没有与画布对齐的像素 latent，姿势和构图由 seed 决定，图中内容还会压过文字修改。编辑方式把草稿的 VAE latent 放进与画布同坐标的序列，姿势、构图、比例几乎一一对应，所以“只参考草稿结构、画风用 LoRA”应使用编辑方式。
- 更正：2026-09-22 “参考图用法”一节把风格参考的三张样例描述为“都是草稿的猫耳水手服少女”，这只说明画出了草稿中的角色和服装；三张的姿势与构图各不相同，并不跟随草稿。据此推荐用风格参考“只参考姿势构图”是错误的。
- 按用户要求删除 `qwen_reference_mode` 的配置、后端分支、前端 `description` 字段、验证脚本参数与相关测试，图生图恢复为单一编辑连法。历史消息里保存的该字段不改写：前端只发送元数据中存在的选项，后端 `qwen_options` 忽略未知键，重新生成按编辑执行。ComfyUI 中 `qwen_image_21_i2i_workflow_api.json` 的说明节点已恢复为只描述编辑连法。
- 111 项后端、75 项前端测试，修改文件定向 lint 与生产构建通过；本地和线上设置弹窗（Qwen、Z-Image，1440／390／320 宽度）均无该选项，旧会话中的 `qwen_reference_mode: reference` 不随生成请求发送。部署后用生产 provider 带该旧值实际生成一次，执行图的编码器接 `vae`、采样经过 `QwenImage21Cache`。

### 2026-09-23 草稿成品化预设

- 用户用编辑方式加 Ameniwa 0.8 把线稿草稿重绘成成品，效果不错。但当时的提示词写了“二次元插画成品：清晰的粗黑色轮廓线，平涂上色，简洁的块面阴影，干净利落的线条”这类画风词，换一个 LoRA 就得跟着改提示词。现在约定：提示词只写任务和内容，画风交给所选 LoRA。
- 提示词助手的“预设”页改为服务端维护的列表，接口为 `GET /api/prompt/presets`（需登录），替代原来的 `/pose-preset`。“参考姿势”保留，另新增“草稿成品化”：

  > @图片1 是线稿草稿。保持草稿中人物的姿势、动作、构图、镜头角度和画面比例不变。将草稿重新绘制成完成度高的成品：线条完整连贯，把草稿里重复、断开的笔画整理成单一、确定的线条；补全五官、手部等未画完的细节；为人物和画面中的物体完整上色，不漏色、不溢色；按统一的光源方向补充明暗，光影关系合理。不要保留草稿的铅笔线、辅助线和涂抹痕迹。

  这段对线条、上色、光影只提完成度要求，不写线条粗细、平涂还是渐变、阴影形状这类画风取向，也不写“二次元”“插画”。后端测试会拦截常见的画风词。
- 如果当前工作流不支持 @ 引用（比如 Z-Image），或者还没添加参考图 1，预设按钮会禁用并写明原因。点击后替换输入框内容，光标停在末尾，接着补人物、服装等具体要求即可。
- 同时发现：此前几次请求写的是 `@图片 1`（带空格），不符合引用格式，没有转换成 `<image1>`，模型收到的是这几个字本身。预设里用的是 `@图片1`。
- 已知风险：按前文的排查，Ameniwa 的训练标注里没有画风词，也没有触发词，画风要靠提示词里的动漫语义才出得来；不写画风词时风格可能明显变淡。这次只提供预设，没有改训练，效果以用户实测为准。如果不够，候选方案有两个：让 LoRA 附带一段画风描述，或者用中性标注加草稿配对数据重训。
- 验证：112 项后端、76 项前端测试，修改文件定向 lint 与生产构建均通过。本地界面检查在 1440、390、320 宽度下覆盖了 Qwen 文生图（无图）、Qwen 图生图（有图）和 Z-Image 三种情况，确认了禁用原因、填入内容、光标位置，页面没有横向溢出或报错。
- 用户实测反馈：预设出图的精细度不够。随后用同一张草稿跑生产 provider 做对照，编辑方式、40 步、seed 7 和 20260923，最后都按应用的规则缩放回原图尺寸再比较：
  - 预设文字影响很小：另写了一版细化文字（逐项要求刻画眼睛的高光、头发分组、衣服褶皱、亮部暗部和投影，同样不写画风词），同 seed 下和现行预设几乎一样。编辑方式会紧跟草稿，“精细刻画”这类要求基本不起作用。
  - 参考图处理分辨率从 1024 提到 1536，采样尺寸从 1120×960 变为 1664×1408，头发、眼睛和衣服的细节更多，但有一个 seed 整体偏淡，1536 配 LoRA 1.0 时还在右下角冒出一个类似训练图签名的笔迹。每张用时从约 66 秒增加到约 156 秒。
  - LoRA 强度从 0.8 提到 1.0，线条更粗更稳，颜色更饱和，暗部也多一些，两个 seed 都有改善，是目前不写画风词时最直接的办法。
  - 和 Ameniwa 原作比，所有对照图都只带出了粗轮廓和平涂色，原作的冷紫色大块阴影、头发高光、腮红和彩色内线基本没有出现。原因与前文一致：训练时没有“草稿 → 成品”的样本，编辑方式下 LoRA 不会给草稿补这些刻画。要在不写画风词的前提下补上，需要按之前的方案重训，加入草稿配对数据。
- 部署：执行了 `deploy: remote` 的等价流程，只删除 `frontend-dist` 卷。部署后后端和数据库健康，后端仍能访问 ComfyUI。线上 `/api/prompt/presets` 未登录时返回 401，`/pose-preset` 返回 404。同一套界面检查在线上静态资源上也通过，检查时接口是模拟的，没有改动真实用户数据。

### 2026-09-23 ComfyUI 重建与端口收紧

- ComfyUI 容器此前通过 FRP 暴露在公网，同时 Manager 的 `security_level` 为 `weak`，因此被入侵：装进了恶意自定义节点，容器层里还部署了 CPU 和 GPU 挖矿程序。证据和时间线见宿主机上的 `/opt/security-evidence/2026-09-23-comfyui/FINDINGS.md`。
- 原容器已停用，改名为 `comfyui-compromised-20260923` 留作取证。用同一镜像重建了新容器，挂载和 GPU 设置不变，改动如下：
  - 端口只绑 `192.168.100.195:8188`；
  - 网络只接 `ai-draw_ai-draw-network`，保留别名 `comfyui`，应用配置不用改；
  - Manager 的安全级别改回 `normal`。
- 旧容器层里 pip 安装的包，重建后要按 ComfyUI 的依赖补回 `/root/.local`（宿主机 `/opt/comfyui/storage/.local`）。这次补了 PyOpenGL 3.1.10 和 glfw 2.10.0。以后安装 Python 包一律用 `pip install --user`，不要装进容器层。
- 核对：应用的 8 个工作流所需节点齐全；同一 seed 的 Qwen 编辑结果，重建前后逐像素相同。
- AI Toolkit 的 8675 也改为只绑局域网地址。注意：它的 compose 只挂载了 `aitk_db.db` 这一个文件，WAL 留在容器层里，重建容器前必须先执行 `PRAGMA wal_checkpoint(TRUNCATE)`。这次重建前没有做，导致双语任务的完成状态回退为 running，队列因此卡住；已按 9/22 的备份恢复，恢复前的库另外备份在 `/opt/ai-toolkit/config/aitk-ui-before-v3-status-restore-*.sqlite`。

### 2026-09-23 Ameniwa v3 重训（草稿配对）

目标：提示词不写任何画风词，只用“草稿成品化”预设，也能画出 Ameniwa 的刻画。

- 数据由 `scripts/prepare_qwen_image_21_v3.py` 生成，测试为 `tests/test_qwen_v3_dataset.py`。数据集在 `/opt/ai-toolkit/datasets/ameniwa_qwen21_v3/`，原数据集不动，沿用 26 张训练、5 张留出的划分。分四组：
  - `t2i_long`：只保留中文段落，去掉英文标签。
  - `t2i_short`：用 Codex 压缩的中文短句，只写内容，脚本会拦截画风词和刻画词。
  - `edit_manga` 和 `edit_coarse`：草稿到原作的配对。草稿分别用 ComfyUI controlnet_aux 的 Manga2Anime 线稿和 LineArt coarse 生成。标注是应用实际发送的预设原文（`@图片1` 已解析为 `<image1>`）；漫画线稿组后面再接内容短句，粗线稿组只有预设。
- 另外两处标注处理：
  - 20 张带签名标签的图，在描述里注明“画面角落有作者签名”，避免 LoRA 学会凭空加签名；
  - GiFLUSJacAAoRE7 的描述去掉了“裙上有蓝紫色块”。那其实是画风里的高光形状，不是衣服图案。
- 配对的尺寸：AI Toolkit 缓存文本特征时，参考图按原图尺寸编码；训练时参考图却按分桶尺寸缩放，两边尺寸不一致就会报 `reference image slots` 不匹配。所以配对图按 AI Toolkit 的分桶算法，预先裁到 1024 分辨率的最终尺寸（不超过 1024²，边长为 64 的倍数），配对组只用 `[1024]` 这一档训练；两个文生图组仍是 512/768/1024 多档。
- 配置文件为 `configs/training/ameniwa_qwen_image_21_v3.yaml`，从基模重新训练，其余参数沿用双语版。文生图组的空标注率为 0.1，配对组为 0.05。共 5000 步，每 250 步存一次；每 500 步出 6 张预览，seed 42、LoRA 0.8，内容包括 `一个女孩`、雨衣那句、用户真实草稿（只用预设，以及预设加一次换装）、两张留出图的草稿。
- 试跑 40 步：平均每步约 2.9 秒，显存峰值 15.0 GB（卡为 RTX 5070 Ti 16 GB），带参考图的预览每张约 38 秒，参考图确实生效，出图跟着草稿的姿势。
- 训练结果：2026-09-23 16:43 UTC 完成 5000 步，用时约 5 小时（含每轮预览）。结束后监视容器启动了 ComfyUI 并恢复服务，临时用户已删除。3000、4000、5000 步三个权重经 `scripts/install_qwen_image_21_lora.py` 校验（384 个张量、192 个非零上投影），以临时名 `AmeniwaQwen21V3_s{3000,4000,5000}.safetensors` 装入 ComfyUI；这些名称未登记，网页里选不到。
- 生产 provider 对照：40 步、参考图 1024、LoRA 0.8，全部提示词都不写画风词；基准是现版双语 Ameniwa 的 0.8 和 1.0。输入、输出和拼图在 `/opt/ai-toolkit/datasets/ameniwa_qwen21_v3_eval/`。
  - 用户真实草稿，只用预设（seed 7、20260923）：现版仍是“粗线加浅色平涂”，几乎没有暗部。v3 的 4000、5000 步出现了原作那种白衬衫上的淡紫块面阴影、皮肤粉色暗部和腮红、头发高光，眼睛刻画也更细，并会加纯色背景（5000 步多为白底）。3000 步颜色过重、偏暗。5000 步在 seed 7 那张右侧多画了黑色剪影。
  - 留出图草稿（漫画线稿加内容描述）：v3 的角、鞋子颜色、玩偶和背景都更接近原作；现版把角画成了粉色羊角，玩偶也丢了。4000 步画面上方出了一行乱码文字。
  - 文生图 `一个女孩`：现版 0.8 出的是照片；v3 三个检查点都是插画，其中 5000 步最接近原作（白底、粗线、平涂）。雨衣句：4000 步叠了一大段乱码文字，5000 步干净。
  - 普通照片编辑（猫改成黑色）：所有版本（包括现版）结果几乎相同，都偏写实，而且都有过度锐化的质感。v3 没有把照片强行改成原作画风。
  - 推荐 5000 步。已知问题：偶尔会多画剪影、签名式的笔迹或乱码文字；有纯色背景的倾向，需要白底时在内容里写明。
- 上线：用户选了 5000 步，新旧版并列。
  - 最终权重经校验安装为 `AmeniwaQwen21V3.safetensors`（SHA-256 `c906cf1d89bfcacec7a07f998f7c8e69ee13e96232229b8d7046c0c8ca6d2c35`，元数据 step 5000、epoch 24），旧文件保留。
  - `lora_models` 现为“Ameniwa”（v3）和“Ameniwa（旧版）”（双语）。两份静态 API 模板和 `scripts/build_qwen_image_21_workflows.py` 的默认 LoRA 已改为 v3。ComfyUI 界面目录里的工作流文件没有改动，仍默认双语版。
  - 118 项后端、76 项前端测试通过。已执行 `deploy: remote` 的等价流程，只删除 `frontend-dist`。
  - 部署后核对：认证接口在两个 Qwen 工作流上都先返回 v3、再返回旧版，用完的临时用户已删除；用生产代码校验登记名并完成一次真实编辑（用户草稿、只用预设、v3 0.8、40 步），输出 1120×960 RGBA。
  - ComfyUI 里的临时候选权重和生成草稿用的中间文件已清理。3000、4000、5000 步的原始检查点保留在训练输出目录。
- 粗稿上的问题（2026-09-24 用户实测）：用户最常用的是很粗的草稿：512px，只勾了轮廓，衣服没画。同一张粗稿、同一段提示词各出 4 张，旧版的效果更好：短发、泳衣都是完整一件，线条干净。v3 5000 步会照描草稿的抖线，没画的衣服则乱编一通，出现拼色、网点、溅色背景和乱码签名，头发长短也不听提示词。原因是训练用的合成草稿直接从成品提取，线条完整且与成品逐像素对齐，模型学会的是照描再上色，没学会重画粗稿、按文字补内容。此前的验收只用了完整线稿，没有覆盖到粗稿。
- 按用户要求，把 3000 步检查点接入试用：校验后安装为 `AmeniwaQwen21V3_s3000.safetensors`（SHA-256 `8fc6fb23312505ffe1194f1ab3fef7155aad944c6835efdb6af2bac031d18831`），在两个 Qwen 工作流中登记为 “Ameniwa（v3 · 3000 步）”，列表顺序为 Ameniwa、3000 步、旧版。118 项后端测试通过，部署后用临时用户核对过列表，临时用户已删除。用粗稿、预设和中性内容（短发、黑色连帽卫衣、牛仔短裤）在生产链路上生成一次，出图正常，1024×1024 RGBA。这张图画出了短发和牛仔短裤，但上衣不像卫衣，局部溢色，线条仍带草稿的抖动，只是单个样本。如果用户实测仍不满意，下一步按计划重训 v4：用真正的粗稿（稀疏、抖动、与成品错位、去掉衣服细节）配“预设 + 内容”标注，去掉训练图里的文字和签名，步数降到 2500–3000。
- 用回旧版（2026-09-24）：用户要求网页先用回旧版，名称改回 “Ameniwa”，其它 Ameniwa LoRA 可以删除。
  - `lora_models` 只保留双语版；两份静态 API 模板和构建脚本的默认 LoRA 改回 `AmeniwaQwen21Bilingual.safetensors`；测试同步修改，118 项通过。
  - 部署前等用户正在跑的生成完成，并确认 ComfyUI 队列连续空闲 60 秒，再执行 `deploy: remote` 的等价流程。
  - 确认训练输出目录中原件的 SHA-256 与安装件一致后，从 ComfyUI 删除了 `AmeniwaQwen21V3.safetensors`、`AmeniwaQwen21V3_s3000.safetensors` 和最早的 `AmeniwaQwen21.safetensors`。Z-Image 的两个 Ameniwa LoRA 属于另一个模型，没有动。
  - 用临时用户核对：两个 Qwen 工作流都只返回 “Ameniwa”（双语版），Z-Image 列表不变；临时用户已删除。
  - 保存过 v3 选择的会话会提示 LoRA 不可用，重选一次即可；应用不改写历史参数。
- 历史标签显示 LoRA 名称（2026-09-24）：
  - 问题：聊天记录里的参数标签原来显示 `LoRA: AmeniwaQwen21Bilingual:0.8` 这样的文件标识。
  - 改法：`WorkflowCatalog.describe()` 新增 `lora_labels`，由 `lora_models` 生成“标识 → 登记名称”的对照，随 `/api/service/workflows` 下发。`ResultGrid` 的两处标签按消息所属工作流查表，现在显示为 `LoRA: Ameniwa:0.8`。已经不在登记表里的标识（比如 v3）照原样显示。
  - 验证：118 项后端、77 项前端测试，定向 lint 和生产构建通过；部署前等 ComfyUI 空闲 60 秒；本地和线上的界面检查（接口为模拟）都确认了这两种显示。
- 改名为 Ameniwa（2026-09-24）：用户要求连文件本身一起改名。
  - 核对训练输出原件和在用文件的 SHA-256 一致（`3f07795c…`）后，用安装脚本校验并装成 `Ameniwa.safetensors`。
  - `lora_models`、两份静态 API 模板、构建脚本和测试同步改为新名称，118 项后端测试通过。
  - 迁移前把 `chat_messages`、`chat_sessions`、`user_configs` 三张表导出到 `/opt/ai-draw-backups/2026-09-24-lora-rename/lora-tables.dump`（pg_dump 自定义格式，附哈希）。部署前等 ComfyUI 空闲 60 秒，部署后在一个事务里把 `<lora:AmeniwaQwen21Bilingual:` 替换为 `<lora:Ameniwa:`：44 条消息、2 个会话配置，用户配置为 0 条；替换后若仍有旧标识，事务回滚。强度不变。这是用户明确要求、并且先做了备份的一次性迁移，是对“不改写历史参数”原则的例外。
  - ComfyUI 界面里的 4 个工作流文件（`image_qwen_image_2_1_*.json`、`qwen_image_21_*_workflow_api.json`），LoRA 取值和说明中的文件名改为 `Ameniwa.safetensors`，原文件备份在同一目录的 `comfyui-workflows/`；随后从 ComfyUI 删除了旧文件。
  - 核对结果：
    - ComfyUI 只看得到 `Ameniwa.safetensors`；
    - 认证接口返回 `{"value": "Ameniwa", "label": "Ameniwa"}`，核对用的临时用户已删除；
    - 用 `<lora:Ameniwa:0.8>` 经生产校验完成一次真实编辑，日志显示加载了 192 个 LoRA 补丁；
    - 线上历史标签显示 `LoRA: Ameniwa:0.8`。
  - 迁移前已经打开的网页，内存里仍是旧标识，需要刷新后再生成。
- 正式任务 `AmeniwaQwen21V3`（`5eea955a-dba5-4140-b5a2-3e15dcbfc24a`）于 2026-09-23 11:40 UTC 开始。训练期间 ComfyUI 停止，应用生图服务暂停。结束后由监视容器 `ai-draw-qwen21-v3-watch`（`/opt/ai-toolkit/config/watch-ameniwa-v3.py`）确认 GPU 空闲，再启动 ComfyUI、恢复服务；状态写在输出目录的 `training-service-watch.json`。这个监视容器需要以 root 运行，并挂载宿主机的 `/usr/bin/docker`。
