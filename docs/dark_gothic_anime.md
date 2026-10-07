# Darkest Dungeon：Qwen-Image-2.1 战斗角色风格

目标是《暗黑地牢》战斗全身角色的比例、粗黑线和重阴影，加上二次元人物设计，女性为主。输出独立角色图；透明素材使用现有去背景工具。训练使用现有 AI Toolkit 0.13.18（源码 `31ddc709c35d3d3b820c636745397561f806b246`）与本机 RTX 5070 Ti，不更新 Toolkit，不改已有 LoRA。

## 素材与定稿数据

用户已授权使用素材。来源为 `nekocon-4090` 的本体 `E:\SteamLibrary\steamapps\common\DarkestDungeon` 与工坊 `E:\SteamLibrary\steamapps\workshop\content\262060`。原始素材、训练图、运行时依赖和权重均在仓库之外。

工作目录：`/opt/ai-toolkit/datasets/dark_gothic_anime_v1`。

- 57 个工坊包中 45 个含英雄素材。本体与英雄包共复制 5293 个文件，约 1.5 GB；提取结束后逐文件校验哈希未变。
- `sources.json` 与 `raw/*/.complete.json` 记录来源、包标题和文件 SHA-256。
- 导出 786 个动作候选；以 Spine 2.1.27 转换器配合固定哈希的旧版官方运行时还原骨骼、网格、atlas 旋转及 draw order。严格按动作名选动画，避免误播同一文件排在首位的 `death`。
- 725 个动作成功导出；缺失配套骨骼、网格不兼容或未找到同名动画的动作记录为排除。旧版失败输出不参与后续筛选。
- 按实际画面选择 Hazu 等匹配素材，筛除偏 Q 版、纤细渐变画法、怪物形态及重复派生包。每个来源造型最多 5 种动作，最多两套配色共享名额；近似动作由感知哈希去重。
- 182 张进入视觉检查和双语标注，4 张被识别出裁切，另经逐图复核排除 6 张服装不稳定或带烘焙投影的动作，最终 **172 张**。
- **训练 156 张、31 个设计组；验证 16 张、4 个设计组**。同一设计的颜色和动作均在同组，已知十字军派生皮肤也合并分组；留出同时覆盖女性和其他角色。
- 训练图中原版 60、工坊 96。按三个数据组设置 repeats：工坊 2、原版明确女性 7、其余原版 1；有效采样 318 张，工坊 **60.4%**、明确女性 **75.2%**。这是采样比例，不是承诺成品呈固定比例的画风融合。
- 主体完整保留，等比缩放后补边，图片边长为 64 的倍数；约 75% 白底、25% 浅灰底。保留原始 RGBA 导出，训练使用 RGB。
- `captions/*.json` 保存 Codex 视觉检查、描述和原图哈希；中英文仅描述内容，禁止画风、作者和作品名。`review/overrides.json` 保存助手逐图复核的修订依据，`manifest.json` 是最终可复查清单。

初稿随机留出曾缺乏女性设计，已换成按来源和性别外观分层的设计组划分；旧草稿保留在 `draft_split_v0`，训练不读取该目录。

## 复现与运行

需要主机 Python 3（Pillow、PyYAML）、Node 22、Chrome，以及现有 `/opt/tools/czn/render` 中的 `puppeteer-core`。旧 Spine 依赖按 `configs/training/dark_gothic_tools.json` 的 SHA-256 校验并下载到数据目录，保留上游许可文本。

```bash
python3 -B scripts/fetch_darkest_dungeon.py /opt/ai-toolkit/datasets/dark_gothic_anime_v1
python3 -B scripts/prepare_dark_gothic_dataset.py jobs /opt/ai-toolkit/datasets/dark_gothic_anime_v1
node scripts/render_darkest_dungeon.mjs /opt/ai-toolkit/datasets/dark_gothic_anime_v1
python3 -B scripts/prepare_dark_gothic_dataset.py review /opt/ai-toolkit/datasets/dark_gothic_anime_v1
python3 -B scripts/prepare_dark_gothic_dataset.py select /opt/ai-toolkit/datasets/dark_gothic_anime_v1
```

`caption_dark_gothic_dataset.py` 应在应用后端镜像中运行，挂载数据目录并复用既有 `.env`；3 路并发，按图片哈希缓存，失败重跑只补缺失标注。不要在日志中打印连接参数或凭据。

逐图审阅后执行 `prepare_dark_gothic_dataset.py finalize`。定稿会拒绝修改过的图片、标注以及混入旧划分的数据；创建新版本时使用独立数据目录。训练配置见 `configs/training/dark_gothic_anime_qwen_image_21.yaml`，数据组 repeats 必须与清单一致。

```bash
python3 -B -u scripts/manage_dark_gothic_training.py start
# 用户明确要求从已记录的暂停状态继续时：
python3 -B -u scripts/manage_dark_gothic_training.py resume
python3 -B scripts/manage_dark_gothic_training.py status
```

启动前确认容器 GPU 可用、无其他训练和连续 60 秒生图空闲；通过认证服务接口暂停生成，再停止 ComfyUI。任务由 AI Toolkit UI API 创建，仍可在其网页观察。训练 8000 步，rank/alpha 32，AdamW8bit，余弦学习率 1.2e-4 至 3e-5，EMA 0.999，分辨率 768/1024。每 500 步保存，每 1000 步预览 8 条内容提示词。

`training-state.json` 与 `training-watch.log` 记录状态。监控由独立系统服务 `aidraw-dark-gothic-watch.service` 管理，在任务终止且队列、主机 GPU 均释放后恢复 ComfyUI 与原先可用的生图服务；监控以主机 NVML 为准，避免 Toolkit 容器失去 NVML 后无限等待。重新启动 `start` 不会重建已经启动的任务。

本次任务 ID 为 `0379138f-471e-4c1d-94cc-eeb19bdbfba2`，2026-10-01 22:09（北京时间）启动。输出目录为 `/opt/ai-toolkit/output/DarkGothicAnimeQwen21`。

### 用户暂停（2026-10-01 23:45）

用户要求晚点继续，已通过 AI Toolkit 的停止接口发送 SIGINT，训练进程正常退出。退出前实际运行至约 4080 步，Toolkit 将任务进度恢复到最后持久化的 **4000 步**。该检查点 384 个张量均有效、192 个上投影非零；配套 `optimizer.pt` 同为 4000 步保存状态。

权重、优化器、配置、日志和 loss 数据库已备份至 `/opt/ai-toolkit/backups/DarkGothicAnimeQwen21-paused-step4000-20261001/`，备份清单记录 SHA-256；任务数据库备份为 `config/aitk-ui-dark-gothic-paused-step4000-20261001.sqlite`。数据目录的 `pause.json` 记录恢复点。监控已自动恢复 ComfyUI，服务接口确认可用。

`manage_dark_gothic_training.py resume` 在用户明确要求继续时使用：核对暂停记录、任务 ID、检查点及优化器哈希、配置和训练图文清单，等待空闲后暂停生图并启动同一训练任务，同时重新初始化恢复监控。`start` 对已启动过的任务仍只返回状态，不会自行续训。恢复时保留原检查点和备份；EMA 状态不持久化，Toolkit 会从已保存的 EMA 权重重新开始累计。

### 继续训练（2026-10-02）

用户明确要求继续后，已恢复原任务，从 4000 步继续训练，目标保持为 8000 步。GPU 可用，无其他训练任务，检查点、优化器与暂停备份的哈希一致，UI 配置与原 YAML 一致。日志确认加载 `DarkGothicAnimeQwen21_000004000.safetensors` 和 `optimizer.pt`，随后从 4001 步继续，学习率约 7.5e-5；原来的备份保留。

续训前任务库备份为 `config/aitk-ui-before-dark-gothic-resume-20261002T010250Z.sqlite`。新增恢复点一致性测试后，本次专项测试为 7 项通过。恢复监控已重新启动，训练结束后恢复生图。

用户中断助手会话后，训练容器继续运行，但原来通过 detached subprocess 启动的主机监控退出了。2026-10-02 在约 5370 步时改用 systemd transient service 接管监控，确认 `ActiveState=active`；`start`/`resume` 后续也采用系统服务，避免再次受到工具会话生命周期影响。5000 步预览里，完整角色描述已有明显画法变化，但极短提示词仍偏照片，部分道具存在漂浮或错位，需以最终多种子测试判断是否通过发布门槛。

### 8000 步完成与独立评估

任务已于 2026-10-02 完成 8000 步。10:33（北京时间）监控确认训练释放 GPU，恢复 ComfyUI；服务状态接口确认可用。最终文件 `DarkGothicAnimeQwen21.safetensors` 的 SHA-256 为 `6ed988f6dc78fe82f6e389f766300fe21b7d2b487b6df6cf9f818941e1b462cf`，384 个张量有效、192 个上投影非零。

7000、8000 步的固定种子 42 预览中，极短提示词「一个女孩」也转为目标画法；这只证明该控制样例改善，最终判断仍使用独立提示词与多个种子。

选择 4000、7000、8000 步进行对比：4000 保留早期内容遵循的对照，后两者覆盖极短提示词开始转换后的阶段。候选曾以 `DarkGothicAnimeEval_s{step}.safetensors` 临时安装到 ComfyUI，未登记到应用列表。评估使用 `scripts/evaluate_dark_gothic_lora.py`，8 条新描述、种子 731946 / 5820193 / 20261001，强度 0.8、40 步、CFG 1，共 72 张。过程由 `aidraw-dark-gothic-eval.service` 管理，记录在数据目录 `eval/strength08/results.json`，逐图检查和失败原因写入 `eval/visual_review.json`。

已查看 0、1000、2000 步预览：2000 步的骑士、女巫、弓手、研究员、士兵和提灯人物开始呈现目标线条和比例，雨衣和短提示词仍偏写实。3000、4000 步预览已经保存在 samples 中，尚待继续评估。正式多种子验收、安装登记和应用部署仍待后续完成。

重启 Toolkit 前必须备份 SQLite 数据库并执行 WAL checkpoint；本次备份为 `config/aitk-ui-before-dark-gothic-20261001T135859Z.sqlite`。

## 验证与发布条件

新增数据单测覆盖补边、组隔离及中英文内容限制；主机集成测试用真实渲染器验证旋转 atlas、颜色及正确动作选择。恢复监控测试覆盖其他任务尚未结束、GPU 尚未释放和 NVML 暂时不可读三个场景。

```bash
python3 -B -m unittest discover -s tests -p 'test_dark_gothic*.py'
```

本次初始完整后端测试运行 182 项，有两项既有错误：`test_qwen_style_free_dataset.py` 引用的脚本缺失；`test_qwen_bilingual_dataset.py` 要求的 `forbidden_list` 不存在。未修改这些旧流程。

通过独立 8 条描述 × 3 个种子评估画法、完整全身、内容遵循及性别表现，门槛为至少 20/24 张满足主要要求。以下为本次助手逐图查看的视觉验收结果，不是自动图像质量指标；完整判定、图像 SHA-256 和备注均保存在 `eval/visual_review.json`。

| 检查点 | 通过 | 结论 |
|---|---:|---|
| 4000 | 19/24 | 未达门槛 |
| 7000 | 21/24 | 采用 |
| 8000 | 21/24 | 达标，保留原件 |

两份后期权重的主要错误集中在同样的三组样例：女海盗出现胡须，一把木剑变为双持，烛台变为难以辨识的法器。4000 步还出现指定白发/光头未满足的情况。7000、8000 步都达到门槛，7000 在部分持握动作、轮廓和游离装饰上更干净，因此选择 7000。

## 正式安装与部署（2026-10-02）

- 文件：`/opt/comfyui/storage-models/models/loras/Darkest Dungeon.safetensors`（2026-10-07 从 `DarkGothicAnime.safetensors` 改名），选自 **7000 步**，SHA-256 为 `95bd82d6e442409621cec4404b11db9889ef0a581fd77a4e9ff38bc3d966008c`；安装脚本确认 384 个张量有效、192 个上投影非零。
- 网页名称：**Darkest Dungeon**（2026-10-07 从「暗黑哥特 · 二次元」改名），默认强度 **0.8**，Qwen 文生图与图生图均已登记；现有 LoRA 保留。
- 图生图：通过生产 provider 输出 1024×1024 RGBA，保留人物、姿势、武器和酒杯，并把红色腰巾改成蓝色；头带也跟随变色，说明局部编辑可能影响同色饰物。结果为 `eval/integration/i2i_s7000.png`。
- 去背景：通过认证 API 调用 BiRefNet，得到 1024×1024 RGBA，alpha 范围 0–255，白色围裙、锅和刀保留。部署前后结果哈希一致，文件为 `eval/integration/transparent_chef_s7000.png`。
- 部署：已执行 `deploy: remote` 的等价顺序，全部使用 `DOCKER_HOST=ssh://nekocon-server`；仅移除 `frontend-dist`，PostgreSQL、上传文件和 Hugging Face 缓存卷均保留。Docker 构建完成，线上服务状态正常。
- 部署后：用临时认证用户核对两个 Qwen 的 LoRA 列表、显示名和默认强度，实际调用生成 API，任务完成且返回 seed 731946。生产 API 图片与独立测试对应图片的 RGBA 像素完全一致。临时用户和临时上传结果已清理，验证图保存在 `eval/integration/api_t2i_s7000.png`。
- 测试：本次专项 7 项通过；Qwen 相关 10 项通过。完整后端 186 项中，183 项通过、1 项因容器没有宿主渲染环境跳过（已在宿主实测通过），两项仍为前述既有标注脚本错误。
- 三个未登记的临时评估 LoRA 已按哈希核对后移除；训练检查点、暂停备份、72 张评估图和判定记录保留。最终交付清单为数据目录 `release.json`。

使用时在 Qwen-Image-2.1 的风格 LoRA 中选择该名称；不要求额外触发词。建议从完整角色描述、1024×1024、强度 0.8 开始。该版本仍可能添加护甲、游离笔触，或误解性别、道具数量及局部编辑范围，正式素材应再检查。

## 改名为 Darkest Dungeon（2026-10-07）

用户指定新名称为 **Darkest Dungeon**。两种 Qwen 模式共用的 LoRA 登记名称和显示名称均改为该值，文件为 `Darkest Dungeon.safetensors`，使用标签为 `<lora:Darkest Dungeon:0.8>`。前后端解析器均支持名称中的空格。

迁移前，将 `chat_messages`、`chat_sessions`、`user_configs` 三张表以 `pg_dump` 自定义格式备份至 `/opt/ai-draw-backups/2026-10-07-darkest-dungeon-rename/lora-tables.dump`，同目录保存原配置、文档、发布清单及哈希清单。在一个事务内替换旧 LoRA 标签前缀，共更新 19 条历史消息和 1 个会话配置，用户配置为 0 条；确认旧标识无残留后提交，原强度保留。

新文件的 SHA-256 与正式发布的 7000 步权重一致。训练任务名 `DarkGothicAnimeQwen21`、检查点文件、数据目录与原始评估记录继续使用生成时的名称，以保留复现和续训路径。改名前的部署与评估记录描述的是当时的名称。

改名专项验证：后端 Qwen 与 LoRA 列表相关 19 项测试、前端 LoRA 与 Qwen 相关 14 项测试通过；额外核对了带空格名称的解析、序列化及两种原生工作流中的 LoRA 节点。

已执行 `deploy: remote` 的等价部署顺序。新镜像中的 19 项后端测试再次通过；认证接口确认两个 Qwen 模式均返回 `Darkest Dungeon` 和默认强度 0.8，数据库旧引用为 0，公网首页返回 200、服务状态正常。ComfyUI 确认新文件可用，旧文件已移至上述备份目录；发布清单 `release.json` 已同步新名称，完整线上检查结果保存在备份目录的 `verification.json`。
