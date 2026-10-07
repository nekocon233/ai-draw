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
- 默认随机 seed，一轮多张时每张各自随机。生成设置可改为固定种子（`qwen_fixed_seed`，文生图与编辑共用），一轮多张时第 n 张使用“种子 + n − 1”。每张结果都记录实际种子，可在结果图上一键复用，见下文“2026-09-30 恢复固定种子”。
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

当前状态（2026-10-07）：两种 Qwen 2.1 模式按顺序登记了 **Ameniwa**、**Sen**、**Daikei**、**CZN** 和 **Darkest Dungeon** 五个 LoRA，标识与网页显示名称相同。Darkest Dungeon 的训练和改名记录见 [战斗角色风格文档](dark_gothic_anime.md)，其余记录见文末相应小节。Daikei 是不写画风标注的 v2 重训（2026-09-30 由 DaikeiV2 改名，历史已迁移）；最初的 v1 保留为 `DaikeiV1.safetensors`，暂不登记。`lora_models` 的条目可用 `default_strength` 指定选中时的默认强度，缺省 0.8，目前所有模型的默认强度均为 0.8。`Ameniwa.safetensors` 就是双语 4000 步权重（SHA-256 `3f07795c…`），由 `AmeniwaQwen21Bilingual.safetensors` 改名而来，历史记录已一并迁移，详见文末“改名为 Ameniwa”一节。v3 的 5000 步、3000 步和最早的 `AmeniwaQwen21.safetensors` 已从 ComfyUI 删除，原件保留在 `/opt/ai-toolkit/output/` 各自的训练目录中，训练产物仍沿用原来的文件名。认证 LoRA 接口仅在登记文件实际存在时展示。其它风格权重安装后仍需在两种模式共用的 `lora_models` 中明确登记，不能直接列入其它架构的 LoRA。网页默认不选 LoRA，此时隐藏强度控件；空行首次选择模型时使用该模型的默认强度，已选模型换成另一个时保留当前强度，选择框、0–1 强度滑条与末尾的 × 位于同一行，数值仅在滑条提示中显示。直接使用静态 JSON 时默认加载 `Ameniwa.safetensors`，强度 0.8。下文保留各阶段安装与验收的历史记录，其中出现的旧文件名均为当时的状态。

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

2026-09-28 起也可以从公网访问 `https://aitoolkit.nekocon.cn`：先用 phaser 站点的网关账号登录，再输入 AI Toolkit 密码。链路为公网服务器 `nekocon-frps` 上的 Caddy，经 frps、本机 frpc 的 `aitoolkit` 代理，到 `192.168.100.195:8675`。AI Toolkit 自身不校验 `/api/img/*`（包括上传，以及只做前缀检查、可被 `..` 绕过的删除）、`/api/files/*` 和 `/api/audio/art/*`，所以公网 Caddy 只放行网关登录或完全匹配的 AI Toolkit 令牌。令牌匹配规则单独存放在该服务器的 `/etc/caddy/aitoolkit-token.caddy`（root:caddy 640），更换 AI Toolkit 密码后要同步更新这个文件并重载 Caddy。该站点的压缩要跳过 `Accept: text/event-stream` 请求：首页监控用 `/api/monitor` 事件流，被 zstd 压缩时事件全部积在缓冲区里（55 秒送出 0 字节），首页会一直转圈。

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

### 2026-09-27 sen 画风数据集准备

- 来源：作者授权用户自行下载的 X 账号 `@morimorihkmi` 的媒体图片。用户提供登录 cookies，用独立虚拟环境中的 gallery-dl 1.32.13（`/opt/tools/gallery-dl`）下载：
  - 只下载图片，不含视频和转推；取原图（`name=orig`），请求间隔 2–4 秒；
  - 共 39 张，存放在 `/opt/ai-toolkit/datasets/sen_raw/`，附推文元数据 JSON 和下载记录；
  - 下载结束后，cookies 文件已粉碎删除。
- 用户人工删除 2 张，保留 37 张（25 JPG、12 PNG），复制到源目录 `/opt/ai-toolkit/datasets/sen/`；`sen_raw` 保持不变。
- 英文标签：
  - 在 ComfyUI 容器内复用 comfyui-see-through 的 WD v3 打标器（`SmilingWolf/wd-eva02-large-tagger-v3`，缓存于 `/opt/comfyui/storage-models/hf-hub`），用 CPU 推理；
  - 打标前先铺白底并补成正方形；通用标签阈值 0.35，角色标签阈值 0.75，格式与 Ameniwa 的 Danbooru 标签一致；
  - 每张 22–71 个标签。`watermark`（6 张）、`signature`（2 张）、`artist_name`、`english_text` 等标签原样保留；
  - 多人或重复排布的图片上，标签不够准确（例如三人合照也会打上 `1girl`）。
- 划分：`prepare_qwen_image_21_training.py --holdout 5` 输出到 `/opt/ai-toolkit/datasets/sen_split/`。随机种子 20260921，训练 32 张、验证 5 张，记录了 74 个文件的 SHA-256。
- 中文描述：
  - 在后端容器内运行 `prepare_qwen_image_21_bilingual.py`（gpt-6-astra，2 路并发），输出到 `/opt/ai-toolkit/datasets/sen_qwen21/`；
  - 标注格式为英文标签、空行、中文段落；中文 144–174 字，没有提及签名、水印或画师；
  - 两个容器内的临时文件都已清理。
- 训练配置：`configs/training/sen_qwen_image_21.yaml`，任务名 `SenQwen21`，参数和预览提示词与 AmeniwaQwen21Bilingual 相同，便于对比。
  - 尚未开始训练，等用户确认后再启动；
  - 训练约占用 GPU 2.5 小时，期间需要暂停生图；
  - 计划的 LoRA 安装名为 `sen`。
- 训练结果（2026-09-26）：
  - 任务 `SenQwen21`（`9593b3a4-089d-4096-a26f-06b47f73a9f8`）通过 AI Toolkit 网页接口创建并排队；建任务前已备份任务库，备份为 `/opt/ai-toolkit/config/aitk-ui-before-sen-*.sqlite`。
  - 首次启动时报 `No CUDA GPUs are available`：`ai-toolkit` 容器自 09-23 起一直运行，期间丢失了显卡访问，容器内 `nvidia-smi` 报 `Failed to initialize NVML`。重启该容器后恢复，下次训练前应先检查容器内的 GPU。
  - 训练期间停止了 ComfyUI；监视容器 `ai-draw-sen-watch`（`/opt/ai-toolkit/config/watch-sen.py`）在任务结束后启动 ComfyUI，并在 23:09 UTC 恢复生图服务。
  - 20:40–23:08 UTC 完成 4000 步，约 2.5 小时，平均每步约 2 秒；显存约 11.3 GB。20 个检查点全部保留。
  - 训练预览对比图：`/opt/ai-toolkit/datasets/sen_qwen21_eval/training_samples_2000_4000.jpg`。
    - 800 步起，二次元类提示词出现该画风；2000 步起，照片类提示词也改为插画；2800 步起，5 条预览全部稳定为该画风。
    - 3200 步起，对“黑色双马尾校服”等具体内容的遵循明显改善。
    - 各阶段都有训练集内容外溢：红色服装、红色方盒或背包反复出现在无关提示词中，也常出现手写文字和涂鸦装饰。
  - 候选检查点为 3200、3600、4000 步，待用户选择后再安装为 `sen`。
- 2026-09-27 更换 AI Toolkit 网页密码（`/opt/ai-toolkit/.env` 的 `AI_TOOLKIT_AUTH`）后，按新环境变量重建了容器。换密码前的 `.env` 和 compose 文件备份在同目录，后缀为 `.bak-20260927T072209Z`。
  - 浏览器里还存着旧密码时，任务页会显示 “Invalid token. Please try again.”，需要重新输入新密码。
  - 重建容器后，`SenQwen21` 在任务库里倒退成“运行中、第 3740 步”，但并没有训练进程在跑。
    - 原因：`aitk_db.db` 使用 SQLite WAL 模式，compose 只挂载了主库文件，`-wal`／`-shm` 留在容器内部。重建容器后，还没合并进主库的记录就丢了。
    - 处理：先把当时的任务库备份为 `/opt/ai-toolkit/config/aitk-ui-before-sen-state-fix-*.sqlite`，再在容器内把该任务改回 `completed`、第 4000 步，并执行 `PRAGMA wal_checkpoint(TRUNCATE)`；worker 随后自动停止了 GPU 0 的队列。
  - 今后重启或重建 `ai-toolkit` 容器前，先执行下面的命令，把 WAL 合并进宿主机上的主库：
    `docker exec ai-toolkit python3 -c "import sqlite3; print(sqlite3.connect('/app/ai-toolkit/aitk_db.db').execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone())"`
- 同日，AI Toolkit 任务页的 Samples 标签报 “Application error: a client-side exception”。
  - 原因：网页端组件读取 `sample.samples.length`，而 `SenQwen21` 和 `AmeniwaQwen21Bilingual` 存的是命令行旧格式 `sample.prompts`，缺少 `samples` 导致页面崩溃。训练本身两种格式都支持。
  - 处理：先备份任务库为 `/opt/ai-toolkit/config/aitk-ui-before-samples-format-*.sqlite`，再把两个任务的预览配置改为 `samples: [{prompt: …}]`，提示词内容和顺序不变，并合并了 WAL。浏览器复查两个任务的 Samples 标签均正常显示。
  - `configs/training/sen_qwen_image_21.yaml` 已同步改为 `samples` 格式。以后通过网页接口建任务时，应使用这种格式。
- 上线（2026-09-27）：用户选择 4000 步。
  - 最终权重 `SenQwen21.safetensors` 的元数据 `training_info` 为 step 4000、epoch 43。
  - 经 `scripts/install_qwen_image_21_lora.py` 校验：384 个张量，192 个上投影非零。安装为 ComfyUI 的 `loras/sen.safetensors`，SHA-256 `751f71a57232c14cc262cc62e1c796b7d5a9675c70b25cbef80e0b668a977f39`，与训练输出的原件一致。
  - `lora_models` 追加 `{name: "sen.safetensors", label: "sen"}`，Qwen 的文字和编辑两个执行图共用；Ameniwa 仍排在第一位，静态模板里的默认 LoRA 不变。`tests/test_generation_pipeline.py` 已同步，160 项后端测试通过，已部署。
  - 部署后，按 `/api/service/loras` 的同一逻辑核对，两个 Qwen 工作流都返回 Ameniwa 和 sen。
  - 用生产 provider 做了一次文生图（`<lora:sen:0.8>`，1024×1024），ComfyUI 历史中 LoRA 节点为 `sen.safetensors`，强度 0.8，用时 55 秒；输出存为 `/opt/ai-toolkit/datasets/sen_qwen21_eval/production_t2i_sen_0.8.png`。
    - 画风生效：粗手绘墨线、明亮平涂；内容遵循提示词。
    - 背景出现类似水印的乱码文字和手写涂鸦，与训练集中的水印和手写字有关。

### 2026-09-28 Daikei 画风数据集准备

- 来源：作者授权用户自行下载的 X 账号 `@Daikei_625`（だいけい）的媒体图片。沿用 sen 的 gallery-dl 虚拟环境（`/opt/tools/gallery-dl`）和参数：只下载图片，不含视频和转推；取原图；请求间隔 2–4 秒。
  - 共 1062 张（推文时间 2022-09-21 至 2026-09-15），存放在 `/opt/ai-toolkit/datasets/daikei_raw/`，附推文元数据 JSON、下载记录 `.download-archive.sqlite3`，日志为 `datasets/daikei_raw_download.log`；
  - 用户要求保留登录 cookies 供下次使用：`/root/x-cookies.txt`，权限 600，不再像 sen 那样下载后粉碎。
- 筛选：1062 张中保留 476 张；用户随后在 AI Toolkit 网页删去 3 张（两张烤面包机、一张文字贴纸），最终 473 张。
  - 去重：先按 dHash 和 pHash 分组（同一张图反复发布，或只换颜色、加眼镜、换背景的差分），再用 ORB 特征点加 RANSAC 找出只是裁切比例不同的版本。每组保留没有大段叠字、分辨率最高的一张，共去掉 347 张。
  - 其余按 WD v3 标签初筛，再逐页人工核对缩略图。剔除截图和宣传图（价目表、封面、Logo、票券）69 张、漫画分格 47 张、纸上草稿 31 张、实拍照片合成 25 张、周边实拍和商品效果图 21 张、大字贴纸 19 张、短边不足 700 像素 13 张、画风不符（厚涂、与他人合作）7 张、模糊特效 7 张。另有 4 张多人插画因 `multiple_views` 被误判为漫画，已恢复。
  - AI Toolkit 分桶不会放大小图（`toolkit/buckets.py` 取 `min(原图像素, 分辨率²)`），小图在 1024 档里也只按原尺寸训练。素材充足，所以仍剔除了短边不足 700 像素的图，它们多为截图或裁切。
  - 按用户选择，DAIKEI 字标和签名原样保留：候选集中 57 张带英文字，52 张带签名。约 75% 是作者的黑发角色，34% 是红色背景，LoRA 会明显偏向这两点。
  - 源目录 `/opt/ai-toolkit/datasets/daikei/`（图片与 WD v3 标签）；审阅用的编号缩略图在 `/opt/ai-toolkit/datasets/daikei_review/`。
- 英文标签：与 sen 相同，在 ComfyUI 容器内用 CPU 运行 WD v3（`SmilingWolf/wd-eva02-large-tagger-v3`），先铺白底并补成正方形，通用标签阈值 0.35，角色标签阈值 0.75。每张 9–57 个标签；容器内的临时文件已清理。
- 划分：`prepare_qwen_image_21_training.py --holdout 5` 输出到 `/opt/ai-toolkit/datasets/daikei_split/`，训练 468 张、验证 5 张。
- 中文描述：`prepare_qwen_image_21_bilingual.py`（gpt-6-astra，3 路并发）输出到 `/opt/ai-toolkit/datasets/daikei_qwen21/`。
  - 这次没有把脚本和数据拷进线上后端容器，而是用后端镜像起一个临时容器：仓库只读挂载为工作目录（读取其中的 `.env`），挂载 datasets 目录，接入 `ai-draw_ai-draw-network` 访问 Codex 代理；
  - 每张约 3.3 秒。
- 训练配置：`configs/training/daikei_qwen_image_21.yaml`，任务名 `DaikeiQwen21`，参数和预览提示词与 SenQwen21 相同，便于对比。数据量约为 sen 的 15 倍，4000 步时每张图平均只训练约 8.5 次；风格很统一，若 4000 步画风不够再从检查点续训。
- 开训（2026-09-28 北京时间 01:35）：任务 `DaikeiQwen21`（`e9fc38ce-9560-4b76-a3ce-7f61763ddd23`）。
  - 开训前：ComfyUI 队列连续空闲 60 秒；用 SQLite backup API 把任务库备份为 `/opt/ai-toolkit/config/aitk-ui-before-daikei-20260927T173214Z.sqlite`；确认容器内 GPU 可用；用临时用户调用 `/api/service/stop` 暂停生图（有任务在跑时该接口返回 409，不会强停），再停止 ComfyUI。停止前核对过 ComfyUI 的网络 ID 与当前 `ai-draw_ai-draw-network` 一致。
  - 通过网页接口建任务需要三步：`POST /api/jobs`（请求体存为 `config/daikei_job_request.json`），`GET /api/jobs/{id}/start` 只负责入队，`GET /api/queue/0/start` 才会启动 GPU 0 的队列。任务信息在 `config/daikei_job.json`。
  - 日志确认 `Found 468 images`、Prodigy、lr 1；第 0 步的 5 张预览已生成，训练约 1.4–2.6 秒一步，显存约 11 GB。
  - 监视容器 `ai-draw-daikei-watch` 运行 `config/watch-daikei.py`（由 `watch-sen.py` 替换任务 ID 生成），用后端镜像、以 root 运行，挂载 docker.sock 和宿主机 `/usr/bin/docker`。任务结束且 GPU 释放后，它会启动 ComfyUI 并恢复生图服务，状态写在输出目录的 `training-service-watch.json`。
- 训练结果（2026-09-28）：
  - 01:43 开始训练步，04:21 保存最终权重，04:24 写完末组预览；连同缓存和每 400 步的预览，共约 2 小时 49 分。20 个检查点全部保留（200–3800 步每 200 步一个，加 4000 步最终文件）。
  - 训练期间 03:10 有一次部署重建了 `ai-draw_ai-draw-network`。停止中的 ComfyUI 仍引用旧网络 ID，监视容器启动它时报 `network ... not found`，一直重试。
    - 处理方法与 09-22 相同：先停监视容器，用 `docker network disconnect -f ai-draw_ai-draw-network comfyui` 解除失效引用，再用 `docker network connect --alias comfyui` 连回现有同名网络，最后重新启动监视容器；
    - 04:32 ComfyUI 启动，生图服务恢复，后端能访问 ComfyUI，临时用户已删除；
    - 以后训练期间如果要部署，需要在训练结束前做这一步检查，或者部署后立即检查。
  - 预览对比图（固定 seed 42、CFG 1、40 步、LoRA 0.8）：`/opt/ai-toolkit/datasets/daikei_qwen21_eval/overview_0_4000.jpg` 和 `candidates_2400_4000.jpg`。
    - 800 步起，动漫类提示词出现粗黑线平涂画风；照片类提示词到 3200 步才全部变成插画。
    - 2800 步的动漫类结果最干净，最接近原作；但 `一个女孩` 和雨衣公交站两条仍是照片。
    - 3200 步起全部插画化，但 `一个女孩` 与 `blue jacket, red cup` 出现类似 DAIKEI 字标的乱码，是保留字标带来的外溢。
    - 3600 和 4000 步：`一个女孩` 稳定变成粉发、红上衣、格子裙（红色内容外溢）；`blue jacket, red cup` 出现面部畸形；线条偏潦草。
  - 候选检查点：2800、3200、3600、4000 步，等用户选择后再安装为 `Daikei`。
- 上线（2026-09-28）：用户选择 4000 步。
  - 最终权重 `DaikeiQwen21.safetensors` 的元数据为 step 4000、epoch 2。经 `scripts/install_qwen_image_21_lora.py` 校验：384 个张量，192 个上投影非零（脚本在 `ostris/aitoolkit:0.13.18` 的临时容器里运行，镜像自带 torch）。安装为 ComfyUI 的 `loras/Daikei.safetensors`，SHA-256 `920337e8e6252fb204bf676b72c8bf51574e48d51f3644c419683310e0eaacfd`，与训练输出的原件一致。
  - `lora_models` 追加 `{name: "Daikei.safetensors", label: "Daikei"}`，排在 sen 之后；`tests/test_generation_pipeline.py` 已同步，165 项后端测试通过。
  - 部署时 ComfyUI 在运行，`compose down` 提示网络仍在使用而保留了网络，所以没有再出现网络 ID 失效的问题。
  - 部署后：两个 Qwen 工作流的 `/api/service/loras` 都返回 Ameniwa、sen、Daikei（默认强度 0.8），`/api/service/workflows` 的 `lora_labels` 已包含 Daikei。核对用的临时用户已删除。
  - 生产 provider 文生图（1024×1024、40 步、seed 42）：ComfyUI 历史中 LoRA 节点为 `Daikei.safetensors`，每张约 55 秒。输出为 `/opt/ai-toolkit/datasets/daikei_qwen21_eval/production_t2i_Daikei_*.png`：
    - `一个女孩坐在咖啡店窗边看书`，强度 0.8：仍是实拍照片，窗上出现手写乱码，画风没有生效；
    - 前面加「二次元插画，」，强度 0.8：变成插画，但线条潦草，有签名状涂写，出现粉发、红衣和红色书包（红色外溢），不如原作干净的粗线平涂；
    - 原提示词，强度 1.0：画面破碎，大量乱码文字。
  - 结论：4000 步只在提示词明确要求插画时生效，而且带有文字和红色外溢，还没有达到「普通中文提示词稳定呈现原作画风」。候选改进：在生产链路对比训练预览中更干净的 2800、3200 步；或清理 DAIKEI 字标和签名、精选画面干净的图、提高每张图的训练轮数后重训。
- 续训到 8000 步（2026-09-28 北京时间 04:58 开始）：用户认为图片多、训练量不够。4000 步时每张图平均只训练约 8.5 次（2.85 轮 × 3 档分辨率），sen 约为 129 次；loss 在 500 步后走平，Prodigy 实际学习率在 2000 步时稳定在约 1.1e-4，说明不是学习率没到位，而是遍历次数少。多训预计能增强画风，但字标乱码和红色偏向来自数据，不会因此消失。
  - 续训前把整个输出目录备份到 `/opt/ai-toolkit/backups/DaikeiQwen21-step4000-20260928/`（2.1 GB，含 4000 步最终权重、19 个中间检查点和 `optimizer.pt`）；任务库备份为 `config/aitk-ui-before-daikei-resume-20260927T205709Z.sqlite`。
  - 配置改为 `steps: 8000`、`max_step_saves_to_keep: 40`：AI Toolkit 只清理带步数后缀的中间检查点，超过上限会从最早的开始删，40 可以保住全部 200–7800 步。结束时会覆盖不带后缀的最终文件，所以 4000 步版本只在备份和 ComfyUI 的 `Daikei.safetensors` 里保留。
  - 续训按创建时间取最新的 `DaikeiQwen21*.safetensors`（即 4000 步最终文件，元数据 step 4000），并加载 `optimizer.pt`。因此续训前不能改动输出目录里的任何文件。
  - 用同一任务 ID 调 `POST /api/jobs` 更新配置，再调用 start 和 queue start。第一轮日志归档为 `logs/0_log.txt`，上一轮监视状态归档为 `training-service-watch-step4000.json`。
  - 监视脚本 `config/watch-daikei.py` 增加了网络自愈：`docker start comfyui` 失败且其网络 ID 已不是当前 `ai-draw_ai-draw-network` 时，自动 `disconnect -f` 再 `connect --alias comfyui` 后重试。监视容器必须在任务进入 `running` 后才启动，否则会把上一轮的 `completed` 当成训练结束。
- 续训结果（2026-09-28 07:40 完成 8000 步）：约 2 小时 42 分钟。检查点 200–7800 步全部保留（共 39 个中间文件），最终文件已被 8000 步覆盖，4000 步原件在备份目录和 ComfyUI 的 `Daikei.safetensors` 中。
  - 预览对比图：`daikei_qwen21_eval/resume_2800_6000.jpg` 和 `resume_6000_8000.jpg`。训练效果不是单调变好：4800 步和 7600 步时 `一个女孩` 又退回照片，雨衣公交站在 4800 步也退回照片。
    - 5600–6000 步 5 条全部插画化，4000 步的畸形和大部分乱码消失，黑白双马尾一条线条最干净；
    - 8000 步 `一个女孩` 接近作者的黑发齐刘海眼镜角色，公交站变为干净平涂，但动漫女孩一条自 7200 步起变成大脸特写；
    - 红上衣、格子裙和橙色圆形背景的偏向贯穿 5600–8000 步，来自数据，多训不会消除。
  - Daikei 结束后，AI Toolkit 队列紧接着运行另一个会话排入的 `CznQwen21`，生图服务要等它结束才会恢复。两个监视容器都在等待，同时恢复不会冲突。
  - 6000、8000 步经安装脚本校验后以 `DaikeiEval_s6000`、`DaikeiEval_s8000` 临时放进 ComfyUI（SHA-256 分别为 `6d3cf801…`、`44430c22…`），未登记到应用。服务恢复后，用生产 provider 对比 4000/6000/8000 步：4 条提示词 × 2 个种子，强度 0.8，40 步，1024×1024。结果写入 `daikei_qwen21_eval/prod_cmp/`，对比图为 `prod_cafe.jpg` 和 `prod_peace_shiba.jpg`。
- 生产对比与替换（2026-09-28 13:35–14:05）：CZN 训练结束、服务恢复后，自动跑完 24 张对比，对比图为 `daikei_qwen21_eval/prod_cafe.jpg` 和 `prod_peace_shiba.jpg`。
  - 8000 步最好：画风生效的场景里，线条最干净、乱写的字最少。红底比耶种子 42 时，4000 步是满画面潦草红线，6000 步叠了大量乱写的字，8000 步是干净的全身像。加「二次元插画」的咖啡店，8000 步最干净，种子 7 的黑发高对比平涂最接近原作。
  - 局限没有随步数消失：写实场景（咖啡店种子 42）和动物（柴犬两个种子）在三个检查点、强度 0.8 下都仍是照片。提示词需要带「插画」「二次元」一类说明，或者描述作者常画的人物和场景。
  - 用户选择 8000 步。沿用 `Daikei` 名称，以原子改名把 ComfyUI 的 `loras/Daikei.safetensors` 换成 8000 步（SHA-256 `44430c2294b5e1a347a282a84133872d47be08dd54e699f104baf627fae83970`），不改应用配置、不部署。4000 步原件（`920337e8…`）在 `/opt/ai-toolkit/backups/DaikeiQwen21-step4000-20260928/`。临时的 `DaikeiEval_s6000/s8000` 已删除。
  - ComfyUI 的 LoRA 节点按文件路径缓存权重，同名替换后必须调用 `POST /free {"unload_models": true, "free_memory": true}` 重置缓存。替换后用同一提示词、同一种子生成，与对比中的 8000 步结果逐像素一致（平均差 0.00，和 4000 步相差 54.05）。
  - 上线后到替换前，有 6 条消息和 1 个会话配置使用过 `Daikei`，重新生成这些消息时会用 8000 步权重。

### 2026-09-28 卡厄思梦境小人（CZN）数据集、训练与上线

- 来源：用户已获版权方授权，从 Windows 上传 PC 国际服客户端的 `bin/appdata/cznlive/` 到服务器 `/opt/tools/czn/client/cznlive/`：`data.pack` 共 6 个分卷，5.9 GB；`gameres` 目录为空。解包、渲染和数据集工具都放在仓库外的 `/opt/tools/czn/`，用法见其中的 `README.md`。
- 解包：
  - 基于 [akioukun/Chaos-Zero-Nightmare-ASSet-Ripper](https://github.com/akioukun/Chaos-Zero-Nightmare-ASSet-Ripper)（MIT，锁定 `53975460`），加 Linux 补丁后构建成无界面的 `czn-ripper:53975460`。补丁内容：POSIX `mmap`、SSRA 路径处理、AES 条目跳过并计数、UTF-8 转换。
  - 每个输出都经过校验，解码失败只报错，不写出文件。用合成的两段加密包和 SSRA 更新包做过自测。
  - 扫描用时 1.5 秒，共 85,702 个文件，覆盖率 99.63%。其中 16,329 个 Spine 骨骼带 atlas，几乎都是 3.8.79 版。
- 纹理与渲染：
  - 纹理为 ASTC 4×4/8×8 和 ETC2，都是预乘 alpha。ETC2 有损压缩会让最多 25% 的半透明像素颜色大于 alpha，而真正的非预乘纹理约 75%，所以按 50% 为界判断。
  - 渲染用无头 Chrome 加 spine-ts 3.8，WebGL 走 SwiftShader，不占 GPU。spine-ts 3.8 在非预乘模式下会把 alpha 通道再乘一次，导致导出颜色偏亮，已改成与引擎一致的 `(ONE, ONE_MINUS_SRC_ALPHA)` 累积 alpha。Screen 混合同样按引擎处理。
  - 隐藏 additive/screen 特效槽，按纹理 1:1 的密度渲染。
  - 用官方 spineboy 的预乘版和普通版对照，白底上平均差 0.22–0.25/255。
- 选小人：
  - 总览拼图在 `datasets/czn_review/overview/`。确认小人是 `model/` 下的 Q 版战斗模型。
  - 不属于小人：`face/portrait` 和 `_battle_ready` 是正常比例的立绘，`card` 是卡牌插画，`map` 是地图标记，10xxxxx 编号是写实风格怪物。
  - 用户选定 108 个：4 位编号 32 个、5 位编号 68 个，以及 8 套 `_01` 换装。
- 候选帧与筛选：
  - 排除受击、死亡、眩晕、崩溃、入场和过渡动作。每个动作取相位 0/0.3/0.6/0.9，共 7108 帧。
  - 再剔除以下几类帧：半透明面积大；必杀技开头被涂成黑色剪影；闪白；部件比待机时明显更分散。
  - 以待机帧为起点做最远点采样，每个动作最多 2 帧。每个角色的上限：战斗角色 6 帧，伙伴 4 帧，换装和 NPC 3 帧。
  - 最终 484 帧，覆盖 107 个角色。`30040` 是全息投影角色，整体半透明，被排除。
- 成品图：
  - 按纹理 1:1 渲染时，小人长边中位数约 300 px（AI Toolkit 分桶不会放大小图），所以经 ComfyUI 用 Real-CUGAN 4x（`up4x-latest-conservative.pth`）放大。
  - 约 75% 白底，约 25% 用 5 种浅色纯色底。人物占画面 55–90%，边长补齐到 32 的倍数，长边上限 1536。
  - 放大器会让纯色底偏 1 个色阶，所以把人物以外的区域重置为准确底色。深色轮廓外侧的放大过冲会在浅色底上形成白边，已把这一圈的亮度限制在不超过底色。
  - 13 张清除了远离主体的零星特效碎块。
  - 数据集放在 `datasets/czn/`，共 484 张 RGB，246 MB。编号审阅图在 `datasets/czn_review/candidates/`，用户没有删图。
- 英文标签：WD v3，参数与 sen、Daikei 相同，在 ComfyUI 镜像的临时 CPU 容器里运行。
  - 删去 `chibi` 类标签。
  - 删去误标的 `transparent_background`：打标器把纯色底上的抠像人物当成了透明底，试跑时 19 张中有 16 张被这样标。
  - 每张 10–65 个标签，浅色底分别标为 grey/pink/green/brown_background。
- 中文描述：`prepare_qwen_image_21_bilingual.py` 新增可选参数 `--forbid`。
  - 禁用词会追加到 system prompt，并在结果里校验，命中就重试。只有使用该参数时才写入 `preparation.json`，旧数据集的标识不变。
  - 禁用词为：Q版、二头身、三头身、SD、大头、小人、卡通、手办、玩偶、公仔、贴纸、精灵图、像素、游戏截图、卡厄思、卡厄斯。这样 Q 版比例由 LoRA 承担，而不是绑定到某个词上。
  - 划分为训练 479 张、验证 5 张，输出到 `datasets/czn_qwen21/`。描述 119–168 字，生成过程中没有触发重试。
- 训练：配置为 `configs/training/czn_qwen_image_21.yaml`，任务 `CznQwen21`（`1bd576ac-aa52-46b3-9219-c790674d3a4b`）。参数与 Daikei 相同，预览提示词在原 5 条外加了 2 条纯内容句。
  - 按用户要求排在 Daikei 续训之后：07:32 入队，07:39 开始训练，10:41 完成 4000 步，约 2 秒一步。
  - 用户随后要求训练到 8000 步，做法如下：
    - 先停掉两个监视容器，避免 4000 步结束时恢复服务；
    - 把输出目录连同 `optimizer.pt` 备份到 `/opt/ai-toolkit/backups/CznQwen21-step4000-20260928/`，哈希一致；
    - 备份任务库，把任务配置改为 8000 步，重新启动任务和队列；
    - 日志确认从 4000 步的权重和优化器接着训练，然后恢复两个监视容器。
  - 13:35 完成 8000 步，监视容器随即恢复生图。续训只保留最近 20 个中间检查点，200–3800 步只存在于上述备份里。
- 效果：
  - 训练预览（seed 42，强度 0.8）：4000 步以前，`一个女孩` 和咖啡馆两条会退回照片；4800 步起，7 条提示词全部是小人画风。对比图为 `datasets/czn_qwen21_eval/training_samples_0_4000.jpg` 和 `training_samples_2000_8000.jpg`。
  - 生产对比：5600、7200、8000 步各跑 4 条训练未用过的提示词 × 2 个种子，结果在 `czn_qwen21_eval/multiseed/`，对比图为 `multiseed_5600_7200_8000.jpg`。
    - 种子 731946：全部是小人。
    - 种子 5820193：7200 和 8000 步的 `一个女孩` 是照片，西装男和实验室两条是正常比例的动漫插画；5600 步的这两条接近写实。
  - 各检查点都有红色服装外溢，也常出现绿色笔刷状色块。
- 上线：
  - 用户选择 8000 步。经安装脚本校验，384 个张量，192 个上投影非零，元数据为 step 8000、epoch 4，SHA-256 `714616d4b94c3ea60e7c6344e609d4196e374c5faafd4f8cac6f2e91d1fb1112`。
  - 起初以 `czn.safetensors`／显示名 CZN 上线，同日改名为 `CZN.safetensors`，见下节。
  - 165 项后端测试通过，已部署。认证接口在两个 Qwen 工作流都返回 CZN，默认强度 0.8。
  - 生产 provider 文生图的结果为 `czn_qwen21_eval/production_t2i_czn_0.8.png`：平涂画风，但这个种子下头身比例偏正常。
- 已知局限：强度 0.8 时，部分种子仍会退回写实或正常比例。需要时可以调高强度，或在描述里写明是插画。

### 2026-09-28 sen、czn 改名为 Sen、CZN

- 用户要求 LoRA 名称统一以大写字母开头：
  - `sen` 改为 `Sen`，文件和显示名都改；
  - 刚上线的 `czn` 一并改为 `CZN`，改的是文件名和标识，显示名本来就是 CZN。
- 先核对在用文件与训练原件的 SHA-256 一致（sen 为 `751f71a5…`，czn 为 `714616d4…`），再用安装脚本校验，装成 `Sen.safetensors` 和 `CZN.safetensors`。`lora_models` 与 `tests/test_generation_pipeline.py` 同步修改，165 项测试通过。
- 迁移步骤：
  - 迁移前把 `chat_messages`、`chat_sessions`、`user_configs` 三张表用 pg_dump 导出到 `/opt/ai-draw-backups/2026-09-28-lora-rename/lora-tables.dump`（自定义格式，附 sha256）。
  - 部署前等 ComfyUI 连续空闲 60 秒，并确认没有进行中的生成。
  - 部署后在一个事务里把 `<lora:sen:` 替换为 `<lora:Sen:`，把 `<lora:czn:` 替换为 `<lora:CZN:`。共改了 20 条消息（Sen 18 条、CZN 2 条）、1 个会话配置，用户配置 0 条。事务内检查没有残留旧标识后才提交，强度不变。
- 核对结果：
  - 两个 Qwen 工作流的认证接口返回 Ameniwa、Sen、Daikei、CZN，`lora_labels` 已同步。
  - 用生产 provider 分别以 `<lora:Sen:0.8>` 和 `<lora:CZN:0.8>` 实际生成，ComfyUI 历史中的文件分别为 `Sen.safetensors` 和 `CZN.safetensors`。
  - 随后删除了 ComfyUI 中旧的 `sen.safetensors` 和 `czn.safetensors`。
- 迁移前已经打开的网页，内存里还是旧标识，需要刷新后再生成。训练产物（`SenQwen21`、`CznQwen21` 和各数据集目录）保留原名。
- 再次续训到 15000 步（2026-09-28 18:37 开始，用户要求）：
  - 续训前备份 8000 步状态（最终权重 `44430c22…`、`optimizer.pt`、配置、日志、loss 记录）到 `/opt/ai-toolkit/backups/DaikeiQwen21-step8000-20260928/`（600 MB）。中间检查点和预览不会被覆盖，没有重复备份。任务库备份为 `config/aitk-ui-before-daikei-resume15000-*.sqlite`。
  - 配置改为 `steps: 15000`、`max_step_saves_to_keep: 80`（原有 38 个中间检查点加新增 34 个，共 72 个）。请求体为 `config/daikei_resume15000_request.json`，第二轮日志归档为 `logs/1_log.txt`，监视状态归档为 `training-service-watch-step8000.json`。
  - 线上 `Daikei` 仍是 8000 步权重，这次续训不影响它。15000 步训完后，再在生产环境对比挑选。
- 15000 步结果（2026-09-28 23:21 完成，约 4 小时 44 分）：监视容器在 23:22 启动 ComfyUI 并恢复生图（中间一次重试是 ComfyUI 启动中的就绪检查）。共 73 个权重文件（200–14800 步每 200 步一个，加 15000 步最终文件），全部保留；最终文件已被 15000 步覆盖，8000 步原件在备份目录和线上 `Daikei` 中。
  - 预览对比图：`daikei_qwen21_eval/resume_8000_15000.jpg`（8000、9200、10400、11600、12800、14000、15000 步）。
    - 10400 步 `一个女孩` 又退回照片。11600、12800 步 `一个女孩` 变成带仿 DAIKEI 字标（如「DARYENA」「DAIHI」）的红色箱子；`blue jacket, red cup` 从 9200 到 14000 步反复在脸上糊红色色块。
    - 14000 步两条女孩提示词都变成作者的黑发齐刘海眼镜角色，最像原作，但压过提示词内容。
    - 15000 步 5 条都干净：平涂清楚，没有字标外溢。
  - 单种子预览起伏很大，是否替换线上 8000 步，仍需生产环境多种子对比。
- 替换为 15000 步（2026-09-29 00:0x，用户选择不做生产对比、直接替换）：
  - 最终权重的元数据为 step 15000、epoch 8，经安装脚本校验（384 个张量，192 个上投影非零）后先装成临时名，再以原子改名覆盖 `loras/Daikei.safetensors`，SHA-256 `0a97530b8cedd165d8603221aa556a95ec8f347185023b8f7a388bfb0fcd6853`。之后调用 ComfyUI `/free` 重置 LoRA 缓存。
  - 验证：红底比耶提示词、种子 42、1024×1024、40 步、强度 0.8，ComfyUI 历史中 LoRA 节点为 `Daikei.safetensors`，与 8000 步同条件结果的平均差为 25.70，说明新权重已生效。输出为干净的全身平涂，黑发齐刘海，红底白卫衣，接近原作；卫衣 Logo 和手边有少量乱码，手势不是标准比耶。文件为 `daikei_qwen21_eval/production_t2i_Daikei_15000_peace_42.png`。
  - 回退：8000 步原件在 `/opt/ai-toolkit/backups/DaikeiQwen21-step8000-20260928/DaikeiQwen21.safetensors`（`44430c22…`），4000 步在 `DaikeiQwen21-step4000-20260928/`。按同样的原子替换加 `/free` 即可换回，应用配置不变。
  - 15000 步只看过单种子训练预览和这一张生产图，没有做多种子对比；写实场景和动物提示词的局限预计仍然存在。

### 2026-09-29 Daikei v2：不写画风的标注、文字遮罩、加大训练量

- 起因：用户试用线上 Ameniwa、Sen、Daikei、CZN 后，认为前两个明显更好。四者对比如下（「每张次数」为训练样本数除以训练图数，三档分辨率各算一次）：

  | LoRA | 训练图 | 步数 | 每张次数 | 标注含 `flat_color` / 粗黑 |
  |---|---|---|---|---|
  | Ameniwa | 26 | 4000 | 约 154 | 0% / 0% |
  | Sen | 31 | 4000 | 约 129 | 0% / 0% |
  | Daikei v1 | 468 | 15000 | 约 32 | 40% / 20% |
  | CZN | 479 | 8000 | 约 17 | 0% / 0% |

  - CZN 的标注里没有画风词，效果同样偏弱，说明主因是每张图的训练次数少；Daikei 的标注还把画风写成了文字（`flat_color`、「人物以粗黑轮廓和大块黑白色面勾勒」），画风被归到这些词上，是额外的问题。
  - 用户曾考虑自己训练或全量微调底模。评估结论：从头训练需要数十亿图文对，成本在 $10⁵–10⁶ 以上；全量微调在 AI Toolkit 里需要关闭 convrot8 量化并改用 14 GB 的 bf16 底模，16 GB 显卡不可行，保留原模型输出、遮罩先验等功能只支持 LoRA，而且问题的根源在数据和训练参数上，所以仍用 LoRA。
  - 用户选择继续用全部 473 张，并把训练量加到 9000 步。
- 不写画风的标注：新增 `scripts/prepare_qwen_image_21_style_free.py`（测试为 `tests/test_qwen_style_free_dataset.py`）。
  - 英文标签删去 `flat_color`、`limited_palette`、`high_contrast`、`no_nose`、`outline`、`drop_shadow` 等画风标签；
  - 中文描述由 Codex 重新生成，只写内容；用 v3 脚本的画风和渲染词表（加上卡通、高对比等）拒收，命中就重试；
  - 按 `black_hair` 标签分成 `train_main`（354 张）和 `train_minor`（114 张，训练时重复 2 次），验证集 5 张沿用 `daikei_split`；
  - 输出 `/opt/ai-toolkit/datasets/daikei_v2_qwen21/`：473 条描述、0 次重试、0 条含画风词，3 路并发约 20 分钟。
- 文字遮罩：`/opt/ai-toolkit/datasets/daikei_v2_masks/`，138 张。
  - 对 WD 标签含文字的 138 张图，在临时容器里用 EasyOCR（英文）检测并识别；
  - 规则：至少 2 个字母或数字、置信度 ≥ 0.25 的框计入；
  - 逐页人工核对后，补上漏检的 DAIKEI 大字、签名和日文，删掉眼睛、头发等误检；102 张有人工修正，记录在 `_records/edits.json`，检测结果、规则和生成脚本也放在 `_records/`；
  - 自动识别的框按文字高度外扩 15%，人工框不外扩；遮罩面积中位数 7.5%，最大 60%；
  - 不用 CRAFT 全图检测，因为它会把眼睛和头发高光当成文字。
  - 注意：AI Toolkit 把遮罩归一化为均值 1（`mask_multiplier / mean`），全黑遮罩会除以 0，所以任何图都不能整张遮住。
- 训练配置 `configs/training/daikei_v2_qwen_image_21.yaml`，任务名 `DaikeiV2Qwen21`：
  - rank 32，AdamW8bit，峰值学习率 1.2e-4，余弦下降到 3e-5；
  - EMA 0.999，不做梯度累积，共 9000 步；
  - 分辨率 768/1024，描述丢弃率 0.1；
  - 遮罩区域损失为 0，并用 `inverted_mask_prior` 让遮罩区域向底模预测学习；
  - 每 500 步保存，每 1000 步预览 7 条提示词（原 5 条加用户常用的 2 条）；
  - 每张次数：主组约 15、次组约 31。
- 训练结果（2026-09-29）：04:00 开训，约 2.73 秒一步（只用 768/1024 两档、rank 32，有遮罩的样本还要多算一次底模预测），11:20 完成 9000 步。11:22 监视容器启动 ComfyUI 并恢复生图。
  - 第 500 步检查点：384 个张量，192 个上投影非零（rank 32，形状 4096×32），学习率按余弦下降，没有碰上 AI Toolkit #1054。
  - 保存和预览用的都是 EMA 权重。最终权重的 SHA-256 为 `c8cf252fb681970d402cf329c1d20e90ff46d07cbc509d7bf5280f5f15dce855`。
- 生产对比：线上 v1（15000 步）与 v2 的 7000、9000 步。用户实际用过的 4 条提示词（女仆装黑白配色、双马尾兔女郎、黑色齐颈短发厚刘海、可爱女孩半身）加上咖啡店、柴犬，各 2 个种子，强度 0.8。对比图为 `daikei_qwen21_eval/v2_maid_bunny.jpg`、`v2_bob_student.jpg`、`v2_cafe_shiba.jpg`。
  - 人物类 v2 明显更像原作：大块黑发、苍白皮肤、黑衣的高对比画面；「黑色齐颈短发」直接出了作者带内层红挑染的黑发角色；兔女郎提示词画出了兔耳（v1 没有）；v1 衣服上的「Daiki」乱码消失。
  - 变差：线条更潦草，个别图笔画凌乱；常出现粉紫色背景；咖啡店种子 42 退回照片（v1 为插画）。柴犬三版都是照片。
  - 7000 与 9000 步几乎相同，采用 9000 步。
- 上线：好坏参半，所以作为单独一项登记，供用户在实际使用中和 v1 比较。
  - 安装为 ComfyUI `loras/DaikeiV2.safetensors`（安装脚本已校验，哈希同上）；
  - `lora_models` 在 Daikei 之后加入 `{name: "DaikeiV2.safetensors", label: "DaikeiV2"}`，同步 `tests/test_generation_pipeline.py`，170 项后端测试通过；
  - 部署前确认线上 `server/`、`comfyui/`、`utils/` 的代码与工作区一致，配置只差这一行；
  - 先构建镜像再停服，以缩短停机时间。
  - 19:19 部署完成：ComfyUI 未停机，网络 ID 与当前网络一致。
  - 两个 Qwen 工作流的 `/api/service/loras` 都返回 DaikeiV2（默认强度 0.8），`lora_labels` 也已包含；核对用的临时用户已删除。
  - 生产 provider 用 `<lora:DaikeiV2:0.8>` 出图，ComfyUI 历史中的 LoRA 节点为 `DaikeiV2.safetensors`，结果与对比中的 9000 步同种子图逐像素一致。
- 续训到 15000 步（2026-09-29 19:41 起）：
  - 续训前备份 9000 步状态（最终权重、`optimizer.pt`、配置、日志、loss 记录）到 `/opt/ai-toolkit/backups/DaikeiV2Qwen21-step9000-20260929/`（311 MB）。
  - 配置改为 `steps: 15000`、`max_step_saves_to_keep: 40`。
  - 续训时 AI Toolkit 会按新的总步数重新计算余弦曲线，并用 `lr_scheduler.step(step_num)` 直接跳到当前步，所以学习率从 3e-5 回升到约 6.1e-5 后再下降。EMA 状态不保存，续训从保存的 EMA 权重重新开始计算。
  - 22:50 保存第 13000 步后，用户手动停止了任务；监视容器把「stopped」当作结束，22:56 启动 ComfyUI 并恢复了生图。
  - 之后任务再次启动时报 `No CUDA GPUs are available`：容器内 `nvidia-smi` 为 `Failed to initialize NVML`，又一次丢失了显卡访问。处理：先 WAL checkpoint，再备份任务库、`docker compose restart ai-toolkit`。
  - 09-30 01:30 从第 13000 步接着训：日志确认加载了 `_000013000` 检查点和优化器状态，学习率 3.4e-5 与余弦曲线一致。
- 15000 步完成与替换（2026-09-30）：
  - 03:02 完成 15000 步，最终权重元数据为 step 15000、epoch 11。
  - 用户要求替换，于是把 `DaikeiV2` 换成 15000 步：先装成临时名，再原子改名覆盖 `loras/DaikeiV2.safetensors`，SHA-256 `497cc44b117afe6599a0080cf0dcc44369edf32b9f16acc756419783dc8a8096`；`Daikei`（v1）不变。
  - 替换时 ComfyUI 尚未启动，不存在旧权重缓存。9000 步原件在 `/opt/ai-toolkit/backups/DaikeiV2Qwen21-step9000-20260929/`。
  - 训练结束后 AI Toolkit 容器再次丢失显卡访问（`Failed to initialize NVML`，当天第二次）。监视脚本要先在该容器里执行 `nvidia-smi` 确认显卡已释放，这一步一直失败，生图没有恢复。处理：停监视容器，WAL checkpoint，`docker compose restart ai-toolkit`，再启动监视容器；03:16 恢复生图。
  - 修复：`config/watch-daikei.py` 和 `watch-daikei-v2.py` 在任务已结束但 `nvidia-smi` 失败时，等 90 秒后视为显卡已释放并照常恢复。原文件备份为 `.bak-20260930`。
  - 对比：v1、v2-9000（临时名 `DaikeiV2Eval_s9000`）和 v2-15000（`DaikeiV2`），用户的 6 条中文提示词（新增猫娘），各 2 个种子。复用上次同提示词、同种子、同权重的 20 张图，只补 16 张。结果在 `daikei_qwen21_eval/v2_15000_cmp/`，对比图为 `v2_15000_*.jpg`。
  - 对比跑到一半时用户叫停，改为自己在应用里对比。临时的 `DaikeiV2Eval_s9000` 已删除，原件在 9000 步备份里。
  - 已完成的部分：猫娘提示词 2 个种子的三版对比（`v2_15000_catgirl.jpg`），以及 v2 在 9000、11000、13000、15000 步的训练预览（`v2_previews_9000_15000.jpg`）。
    - 15000 与 9000 几乎一样：同种子的猫娘图只是头发的黑色块更实一些。预览里女仆装和雨衣公交站略干净，但「一个女孩」仍固定为红衣格子裙和橙色圆底。后半段学习率只有 3e-5 到 6e-5，模型基本已经收敛。
    - v1 与 v2 差别更大：v1 更柔和（浅色底、皮肤有柔和阴影、脸更精致），v2 更接近作者本人的画法（纯白底、大块纯黑头发、线条更硬）。用户觉得 v2 不如 v1，说明用户想要的是精致的通用平涂，而不是更像作者本人的笔触。
- 2026-09-30 03:26 用户反馈无法生图，报错 `ComfyWorkflowWrapper(self.temp_workflow_file)` → `TypeError: 'NoneType' object is not iterable`。
  - 根因：训练前暂停生图调用 `/api/service/stop` → `ComfyUIService.close_connect()`，会删除当前工作流的临时副本，并把 `temp_workflow_file` 置空，但 `current_workflow_type` 不变。恢复时 `/api/service/start` 只把服务标记为可用，不重新加载工作流。此后第一次生成如果和暂停前是同一个工作流，`switch_workflow` 会跳过加载，直接读空路径。
  - 以前没暴露，是因为训练后恰好都有过部署（后端重启），或者用户先切换了工作流。03:25 ComfyUI 被 `docker restart` 与此无关。
  - 处理：先重启后端恢复使用。再修复：`ComfyUIService._workflow_file()` 在临时副本缺失时按当前类型重新加载，三个生成入口都改用它。新增 `tests/test_comfyui_service.py` 复现暂停、恢复、再生成：修复前报同样的 TypeError，修复后通过；171 项后端测试通过，已部署。
- 同种子强度对比（2026-09-30）：
  - 设置：用户用固定种子 4089305171 和猫娘提示词，比较 v1 与 v2 在 1.0、0.8、0.6 三档的效果。用户满意 **v1 @1.0** 与 **v2 @0.8**。
  - 画风阈值：作者标志性的红眼、红色耳内，v1 在 0.8→1.0 之间才出现（红色像素 0.05% → 0.20%），v2 在 0.6→0.8 之间出现（0% → 2.15%）。0.6 时两版都退回底模的通用动漫脸，这时跨版本差异最小。
  - v2 过头：v2 从 0.8 到 1.0 的画面变化量是 v1 同区间的 1.6 倍，1.0 时头发变深变长、暗红描边加粗、脸型变窄，已经过头。两张满意图的画风并不相同：v1 为浅灰底、细黑线，v2 为白底、较粗的红棕描边。它们只是各自刚好越过阈值、还没过头。
  - 原因：v1 的 468 条标注中，`flat_color` 191 条、「粗黑」98 条、`limited_palette` 80 条、「色块」55 条，v2 一条都没有。
    - v1 的一部分画风由这些词承担。用户的提示词不写这些词，所以要开到 1.0 才补足。
    - v2 的画风全部记在权重里，0.8 就够；1.0 会把原作偏重的粗描边、深色块全量带出。
  - 权重本身解释不了强度差异：
    - v2 的增量 ΔW 总范数只有 v1 的 0.63 倍（51.5 对 81.9）；
    - 两版都高度集中，最大奇异方向约占 65% 能量；
    - 两版方向几乎正交（余弦 0.04）。
    - 因此不同 LoRA 的强度数值不能直接横比。
  - 本结论只来自一条提示词、一个种子；统一改默认强度之前，应再换几组提示词和种子确认。

### 2026-09-30 恢复固定种子：设置、记录与一键复用

用户要求在设置里可以指定种子，并确认了三点：图片和视频都要；一轮生成多张时每张依次加 1；记录每张的实际种子并能一键复用。09-23 按当时的要求删掉了 `qwen_seed`，这次使用新的键重新加入，旧键仍由前端过滤、后端忽略。

- 元数据新增参数类型 `seed`：空字符串表示随机，整数表示固定。
  - Qwen 文生图与编辑共用 `qwen_fixed_seed`，两种 H3 方式共用 `h3_fixed_seed`；GPT Image 没有种子。
  - 图片和视频用不同的键，切换时互不影响。
  - 取值范围 0 到 2^53 − 1（JSON 能精确表示的最大整数）。随机种子取 32 位，便于阅读和输入。
  - 一轮 n 张时要求“种子 + n − 1”不超过上限：前后端都校验，后端报“种子必须在 0 到 N 之间”。
- 执行：
  - 注册了 `seed_option` 的 provider（Qwen、两种 H3），由 `GenerationEngine` 用 `round_seeds` 定出本轮每张的种子，通过 `ProviderInput.seed` 传给 ComfyUI。固定时第 n 张用“种子 + n − 1”；随机时每张各自抽取互不相同的 32 位种子。
  - 最初随机模式也是抽一个基准再依次加 1，用户反馈“选的随机，种子却连号”后改为逐张随机（见下文“LoRA 列表、默认强度与设置弹窗”）。每张的种子都单独记录，复用任何一张都不受影响。
- 记录：
  - `generated_images` 新增可空列 `seed BIGINT`，由启动时的幂等 DDL 添加；旧结果、编辑后的图片和没有种子的工作流为 NULL。
  - WebSocket 的 `media_generated` 和 `preview_update` 携带 `seed`，任务快照带 `seeds`。
  - 历史与轮次接口返回与 `images` 一一对应的 `seeds`；`/chat/save` 也接受 `seeds`，前端调整或编辑图片后按图片地址重新对齐。
- 界面：
  - 生成设置末尾新增“种子”：可在“随机/固定”之间切换，固定时可输入数值，或用按钮换一个随机值。
  - 多张时提示“4 张依次使用 N–N+3”。数量调大导致越界、或选了固定但没填数值时，不能保存。
  - 结果图左上角显示“种子 N”：桌面悬停时出现，触屏上常驻，点击范围扩到 44px。点击后把该种子固定到对应工作流并保存到会话；如果当前是另一类工作流，提示切换过去后生效。
  - 固定种子的轮次显示“固定种子: N”标签；编辑重生成沿用该轮的固定种子。
  - 固定种子期间，输入栏的设置按钮显示小圆点，按钮名称带上当前种子，避免忘记改回随机而一直出同样的图。
  - 新会话恢复为随机。
- 验证：
  - 后端 181 项、前端 123 项测试，以及改动文件的定向 lint、生产构建均通过。全量 lint 仍有 `utils/helpers.ts`、`utils/indexedDB.ts` 原有的 24 个错误。
  - 浏览器检查使用模拟接口与 WebSocket，在 1440、390、320 宽度下 47 项全部通过，覆盖：设置校验与提示、请求携带种子、结果逐张显示、复用后保存、视频种子与图片种子分开、设置按钮圆点、新会话恢复随机，以及手机上底部操作栏保持一行、没有横向溢出。
  - 04:11 部署。部署前确认 ComfyUI 队列已连续空闲 60 秒，用户最近两轮都已完成落库。
  - 线上核对：元数据返回两个种子参数，`generated_images.seed` 列已添加。临时用户用 Qwen 文生图生成 512×512、20 步：
    - 固定种子 424242 生成两张：任务快照、轮次接口、数据库和 ComfyUI 执行图中的种子都是 424242、424243；
    - 随机生成一张：记录为 1165148824，与执行图一致；
    - 生成两张时传入 2^53 − 1，返回 422“种子必须在 0 到 9007199254740990 之间”。
  - 核对后已删除临时用户、会话和生成的文件。

### 2026-09-30 LoRA 列表、默认强度与设置弹窗

用户对比后先要求下架 v1、把 v2 的默认强度设为 0.7，随后改为“v2 就叫 Daikei，默认 0.8”。另提了三点：换 LoRA 时不要重置强度；随机种子不该连号；生成设置弹窗尽量不出现滚动条。

- Daikei 改名（最终状态）：
  - ComfyUI 中 v1 的 `Daikei.safetensors`（`0a97530b…`）改名为 `DaikeiV1.safetensors`，不登记；v2 的 `DaikeiV2.safetensors`（`497cc44b…`）改名为 `Daikei.safetensors`。`lora_models` 只登记 `{name: "Daikei.safetensors", label: "Daikei"}`，默认强度 0.8。
  - 迁移前用 pg_dump 导出 `chat_messages`、`chat_sessions`、`user_configs` 到 `/opt/ai-draw-backups/2026-09-30-daikei-rename/lora-tables.dump`（附 sha256）。
  - 等 ComfyUI 连续空闲 60 秒后停服，两个文件用 `mv -n` 改名，并调用 ComfyUI `/free` 清空模型与执行缓存。之后只启动数据库，在一个 DO 块里迁移（数量不符即回滚），最后全部启动。停机约 14 秒。
  - 历史消息如实记录所用权重：21 条 `<lora:Daikei:` 改为 `<lora:DaikeiV1:`，7 条 `<lora:DaikeiV2:` 改为 `<lora:Daikei:`。v1 的历史轮次因此不能直接重新生成，会提示 LoRA 未登记。
  - 会话配置表示“下次用什么”：3 个 DaikeiV2 改为 Daikei；原来选 v1 的 2 个（「泳装猫娘全身绘制」0.6、「金发校服女生设计」1.0）保持 `Daikei`，即改用 v2，强度不变。用户配置没有相关记录。
  - 迁移前已打开的网页，内存里还是旧标识，需要刷新后再生成。
- 默认强度：`lora_models` 的条目可写 `default_strength`，由 `server/lora_catalog.py` 下发，缺省为 0.8。中途曾给 DaikeiV2 设 0.7，改名后按用户要求用缺省 0.8。
- 换模型保留强度：LoRA 选择器里把已选模型换成另一个时，保留这一行的强度；空行首次选择和“添加 LoRA”仍用模型的默认强度。
- 随机种子：`round_seeds` 在随机模式下为每张抽取互不相同的 32 位种子，不再“基准 + n”连号；固定种子仍是“种子 + n − 1”。设置里随机模式的提示改为“每张随机”。
- 设置弹窗：正文最大高度由 `min(70dvh, 680px)` 改为 `calc(100dvh - 140px)`（标题和按钮约占 116px，上下各留约 12px）。字段间距由 24px 收到 16px，最后一项不留底距；窗口高度不超过 860px 时，间距再收到 12px，标签下距 4px。
  - 实测正文所需高度（改前 → 改后）：Qwen 文生图 713 → 641（窄窗口 589）；编辑模式关闭原图尺寸 827 → 747（687）；视频 498 → 442（406）。
  - 窗口 1920×950、1440×900、1440×790，以及手机 390×844、390×750 下，Qwen 文生图和视频都不再滚动。
  - 仍会滚动的情况：约 650px 高的小窗口、320px 宽的小手机，以及编辑模式关闭原图尺寸、显示宽高滑条时 790px 以下的窗口。
- 验证：
  - 后端 182 项测试通过，其中新增逐张随机种子与按模型默认强度的用例；前端 123 项测试和改动文件 lint 通过。
  - 浏览器检查全部通过：LoRA 切换 11 项（调到 0.5 后换模型仍为 0.5、空行首选用默认值、添加 LoRA 用默认值、未登记的旧 LoRA 提示不可用），种子回归 47 项；弹窗高度按上面的尺寸逐一测量。
  - 04:56 部署后的线上核对（临时账号，结束后已删除账号、会话和文件）：
    - 两个 Qwen 工作流的 LoRA 接口返回 Ameniwa、Sen、Daikei、CZN，默认强度都是 0.8；`lora_labels` 同步。`DaikeiV1`、`DaikeiV2` 都返回 422 未登记。
    - 随机模式两张的种子为 515915913 和 1032246189，不连号，与 ComfyUI 执行图一致；执行图中的 LoRA 为 `Daikei.safetensors`，强度 0.8。
    - 用新名 `<lora:Daikei:0.8>` 和种子 4089305171 重跑用户的猫娘提示词（1024×1024、40 步），结果与改名前 DaikeiV2 0.8 的图逐像素相同。这说明改名正确、ComfyUI 没有沿用缓存的 v1，固定种子也能完全复现。
