---
name: aidraw
description: "用本机 ai-draw（https://aidraw.nekocon.cn）为游戏或其他项目生成、处理图片和动画素材，并在 ai-draw 网页里让用户预览、选用、写意见后再继续。覆盖文生图、参考图生图（可叠 LoRA）、GPT Image 编辑、首帧驱动的视频转序列帧、抠图、放大、把处理好的素材发回会话、按项目规格交付，以及接手用户在网页里的编辑（编辑帧、编辑）。用户说“用 ai-draw 出图”“AI 生图”“做立绘/道具/图标/可平铺背景”“做待机/动作动画”“序列帧”“换正式美术”“用 LoRA 画”“在 ai-draw 里挑图”时使用。"
---

# ai-draw 生图工作流

本技能供 Claude Code、OpenCode、Codex 共用。agent 用 `aidraw` 命令驱动本机 ai-draw；用户在 ai-draw 网页里看结果、点「选用」、写意见，再点「提交给 Agent」或「都不满意，重来」。所有生成都记成网页会话里的一轮，用户随时可以在同一会话里亲自改提示词重画、编辑、抠图，他自己的结果同样可以被选用。

## 1. 适用范围

- 能做：Qwen-Image-2.1 文生图和参考图生图（可叠 LoRA）、GPT Image 编辑、MiniMax H3 视频（`aidraw video`）及抽帧做序列帧、后端抠图（背景处理算法）和放大、本地后处理（`scripts/`）、把处理好的素材发回会话、开审核关卡等用户决定、接手用户在网页里的编辑。
- **循环动作默认只传首帧**：使用 `--first` 和 `--preset video_motion`，不传 `--last` 或 `--loop`，后处理时截取完整、首尾接得上的动作循环。尾帧约束容易让 H3 提前完成动作，短片后半段停在尾帧。只有用户明确需要指定两端的过渡时，才使用尾帧和 `video_transition`。具体见 [animation.md](references/animation.md)。
- 暂不提供命令：H3 动作参考视频（`minimax_h3_ref`）。需要时可以先在网页里手动做，再用 `aidraw round get` 下载结果。
- 不在本技能里做：修改或部署 ai-draw。部署会重启后端、中断正在跑的生成，必须先问用户。

## 2. 开工检查

1. 运行 `aidraw doctor`，确认令牌、服务、生成槽和 LoRA 都正常。
   - 没有令牌：先 `aidraw auth users` 列出账号，问用户用哪个账号，再 `aidraw auth setup --user <账号>`。令牌只保存在 `~/.config/aidraw/`，不要打印或转述。
   - `service` 不可用：多半是 ComfyUI 停了（例如正在训练 LoRA）。告诉用户，不要自己重启。
2. 读项目约定（`AGENTS.md` / `CLAUDE.md`）。游戏项目再读美术规格：`art/spec.json`、`art/style.md`、`art/jobs/`。没有的话按 [job-records.md](references/job-records.md) 先建，并请用户确认关键约束。
3. 和用户确认这一轮做哪些素材，以及用哪一档颗粒度（见下表）。

## 3. 核心概念

- **job**：一组相关素材，例如“主角立绘”“墙面道具”。一个 job 对应一个 ai-draw 会话（标题用 `Agent · <项目> <任务>`）和一个任务日志 `art/jobs/<job>.jsonl`。
- **step**：一次生成或处理。命令都带 `--job <日志> --step <名字>`，以后换会话也能接着做。
- **gate（审核关卡）**：在会话里提问，等用户在网页里选用或确认。一个会话同时只开一个。

| 颗粒度 | 在哪里停下来 |
|---|---|
| `auto` | agent 自己挑，只在交付后留一个可选关卡 |
| `key`（默认） | 风格定调、选候选、交付后可选关卡，三处 |
| `every` | 每次生成或处理后都停 |

## 4. 标准流程

1. 读规格，建会话：`aidraw session new --title "Agent · classroom 主角立绘"`，把返回的 `link` 发给用户。
2. **风格定调**（项目还没有 `art/style.md` 时才做）：同一描述分别用不挂 LoRA 和两三个候选 LoRA 各出 2 张，开关卡请用户选，把结论（LoRA、强度、风格描述、禁用词）写进 `art/style.md`。
3. **出候选**：`aidraw gen`，每批不超过 4 张。参考图、LoRA、种子见 [workflows-loras.md](references/workflows-loras.md)，具体素材看对应配方。同一请求只换种子再出时，结果追加到上一轮、在同一个气泡里。
4. **自查**：结果下载到本地后，先用 `scripts/sprite_tools.py contact` 拼成编号图自己看一遍。剔掉朝向错、缺手脚、多余文字、背景不干净的；全部不合格就调整后重出，不要把废片交给用户挑。
5. **开关卡**：结果一出来就要开。在 `aidraw gen` / `aidraw video` 上加 `--gate "问题"`，或者在同一条后台命令里紧接着运行 `aidraw gate open`，不要等自己被唤醒后再开，也不要先做完后处理再让用户挑。告诉用户链接、要选几个、看什么。等待方式见 [review-gates.md](references/review-gates.md)。
6. **按结果走**：`approve` 就用选中的图继续；`redo` 读 `note` 调整后重来；关卡被撤销或用户在对话里改了主意，以对话为准。
7. **后处理**：
   1. 抠图只用后端的背景处理算法：先用 `scripts/cutout_compare.py` 让全部算法各抠一次，自己看对比图，挑出最好的一种。挑选标准见 [alpha-and-cleanup.md](references/alpha-and-cleanup.md)。对比图留在本地，选了几号、为什么在对话里说。
   2. 需要时做 `rectify`，再缩放到规格尺寸。棋盘格、深色底和 `mock` 游戏光照预览只用来自查。
8. **交付**：按项目流程写入文件、更新规格和 asset pack、自检（[phaser-delivery.md](references/phaser-delivery.md)）。
9. **发素材、留交付后关卡**：
   1. `aidraw post` 只发处理好的素材本身（透明成品、精灵图动画），说明写在同一条帖子里（第 5 节）。
   2. 紧接着开交付后关卡：`aidraw gate open --min 0 --max 1`，问题模板见 [review-gates.md](references/review-gates.md)。
   3. 在同一条后台命令里等它。`gate wait --job` 会给每个选中项标上 `by`（`agent` 或 `user`）；agent 的媒体再标 `source`（`gen` 或 `post`）。
      - 不选直接提交，或者选用了 agent 发的成品帖（`by=agent, source=post`）：用户满意，结束。用户很自然会选用自己满意的那个，这不是要处理的编辑。
      - 选用了另一段生成的视频或另一张生成的图（`by=agent, source=gen`）：换用它重新交付，再发素材、再开交付后关卡。
      - 选用了用户自己的编辑结果（`by=user`）：按人工编辑交付（第 6 节），再发素材、再开交付后关卡。
      - 「都不满意，重来」：读 `note`，回到第 3 步。这一步要 agent 来判断，所以后台命令退出时必须能唤醒 agent。
   4. **等关卡要用会唤醒 agent 的后台任务**（Claude Code 的 `run_in_background`），超时（退出码 2）就重新跑一次接着等。
      - 不要用 `nohup`、`setsid` 这类脱离会话的进程：用户点「重来」后没人处理，他只会看到回答气泡一直停在“等待 Agent 读取”。
      - agent 确实要离开时，在对话里告诉用户：关卡里的回答要回来说一声才会处理。
   5. 结果、检查和游戏里的样子在对话里报告，项目验收照项目规则走。

后台命令串成“等关卡 → 后处理 → 交付 → 自检 → 发素材 → 交付后关卡”，用户提交后不需要等 agent 回复。

## 5. 会话里放什么

ai-draw 会话是用户挑图和编辑的地方，只放四类内容：

1. 生成结果：agent 的 `gen`、`video`，以及用户自己画的。
2. 用户在网页里的编辑：编辑帧导出、编辑、背景处理、放大。它们会追加在原来那一轮里。
3. agent 用 `aidraw post` 发的**处理好的素材**：抠好的透明成品、精灵图动画（棋盘格底），以及要用户挑的候选抠图。说明文字显示在 Agent 一侧，和素材在一起。
4. **关卡的问答**：后端自动生成，agent 不用另外发帖。
   - 开关卡时，左侧留下 Agent 的提问气泡，注明要选几个；关卡结束后标成“已回答”或“已撤销：原因”。
   - 用户提交时，右侧留下他的回答气泡：选了哪些（带缩略图）、“满意，直接提交”，或“都不满意，重来：意见”。
   - 回答气泡下显示“Agent 已收到”或“等待 Agent 读取”。`aidraw gate wait` 读到回答时会自动标上“已收到”，agent 在对话里替用户提交时也一样。

说明文字和素材放在同一条帖子里，只写这份素材本身：

- 是什么；
- 关键参数，例如尺寸、帧数、帧率、抠图算法；
- 和上一版的区别。

不发进会话（这些都在对话里告诉用户，附本地文件路径）：

- 只有文字的帖子：更正、状态、道歉、过程说明。`post` 必须带素材。
- 游戏截图、`mock` 光照预览、抠图对比图、检查结果。

**发错了**：不要发更正帖。用 `aidraw round delete --session S --message M --job <日志>` 删掉自己发的那条（只能删任务日志里记为 agent 发帖的轮次），重新发正确的素材，原因在对话里说。

**换了会话还要给用户看以前的生成结果**：用 `post --url` 原样转发，说明只写“上次的第几段/第几张”。

## 6. 人工编辑

用户随时可以在 ai-draw 里自己改：

- **视频**：在视频那一轮点「编辑帧」，可以选帧范围和帧率、逐帧修改、背景处理、裁切，然后导出精灵图。
- **图片**：点「编辑」。

编辑结果会追加在原来那一轮里。

**怎么接手**：
- 交付后关卡就是入口：用户选用自己的编辑结果再提交，后台命令下载它（`gate wait --download`），接着交付。
- 用户在关卡之外编辑完、在对话里说一声时，按下面两步找到并下载：
  1. `aidraw round list --session S --job <日志> --user-only` 列出任务日志里没有的媒体，也就是用户的编辑和他自己生成的轮次。
  2. `aidraw round get --session S --message <那一轮> --out <目录>` 下载。

**处理原则**：
- 用户的帧和像素原样保留：顺序、重复帧、画过的地方都不动。
- 只做对齐立绘、缩放、打包、登记，以及无损清理（去杂点、去白边）。
- 帧还带着背景时，才用项目选定的抠图算法。
- 发现问题，例如重复帧、循环接缝、帧率拿不准，在对话里说明并给出选项，不要自作主张改掉。

**动画**：
- 用 `scripts/edit_to_sheet.py`（见 [animation.md](references/animation.md)）。
- 新导出的精灵图自带导出记录（PNG 里键名为 `ai-draw` 的 iTXt 块；ZIP 里是 `meta.json`）：帧数、网格、帧尺寸、帧率、每帧在原视频里的时间。
- 旧导出没有记录时，脚本按原视频尺寸和透明分布推算网格，再和原视频逐帧比对推算帧率。

**静态图**：编辑后的图走静态交付步骤。已经透明的就不再抠图，只做 `rectify`、缩放和登记。

**记录**：
- 规格的 `source.edited_by_user` 写编辑结果的地址。
- 任务日志记 `deliver`，step 为 `user-edit`。

## 7. 和用户协作

- 每次开关卡都给出会话链接，说清楚：要选几张、判断标准是什么、可以写什么意见。
- 告诉用户可以直接在同一会话里干预：改提示词重画、编辑、设为参考；他自己画的结果也能选用。
- 用户在对话里直接回答（例如“选 3，脸再圆一点”）也算数：用 `aidraw gate submit` 原样记录他说的选择，或者用 `aidraw gate cancel --reason` 撤销关卡后按对话继续。不要替用户做没说过的决定。
- 关卡上的“通过”只代表这一步的选择，不等于项目验收。项目自己的验收和提交规则照旧。

## 8. 共享生成槽

- 整台 ai-draw 同一时间只能跑一个生成任务，用户手动生成也用这一个槽。`aidraw gen` 会先排队，每两个任务之间让出 20 秒，方便用户插队。
- 每批不超过 4 张（Qwen 1024² 约 55 秒一张）；大批量先问用户。
- 用户在网页里能看到并停止 agent 的任务。被停止时命令返回退出码 4，并保留已完成的结果；重新提交前先问用户。

## 9. 质量红线（游戏素材）

- 朝向、锚点、尺寸以项目规格为准；角色脚底贴画布底边，左右居中。
- 门窗、柜子、告示牌等平面道具要正交：边框横平竖直，没有透视和倾斜（必要时 `sprite_tools.py rectify` 校正）。
- 只画固有色：不画投影、光斑、暗角、雾气、颗粒（游戏的光照和后期会叠加上去）。
- 抠图只用背景处理算法（`aidraw rmbg` / `cutout_compare.py`），不用换色或颜色键：被主体围住的空隙（手臂和身体之间、两腿之间）会残留背景。
- 透明边缘干净：没有白边、灰边、残留背景块。要在亮、暗两种底上都检查。
- 缩到交付尺寸后线宽一致（通常 2 px 左右）；同一场景的道具缩放倍数要接近。
- 不用 `sketch_finish`（参考图成品化）预设做游戏素材：它要求画明暗和接触阴影。
- 画面里不要出现水印、签名、乱码文字；需要文字时（门牌、标志）先确认规格要求文字是否由代码绘制。

## 10. 失败与续跑

| 退出码 | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | 继续 |
| 1 | 参数或本地问题 | 读 `error` 修正 |
| 2 | 超时，任务或关卡仍在进行 | 运行输出里的 `resume` 命令接着等 |
| 3 | 服务端拒绝或生成失败 | 读 `error`；422 多半是参数、尺寸或 `<imageN>` 引用不对 |
| 4 | 用户停止了任务，或关卡被撤销、删除 | 问用户下一步 |
| 5 | 后端重启，任务丢了 | 问用户后重新提交 |
| 6 | 令牌问题 | 重新 `aidraw auth setup` |
| 7 | 生成槽长时间被占用 | 告诉用户，稍后再试 |

单次等待默认最多 540 秒，以适配 agent 工具的超时；Claude Code 可以把 `aidraw gate wait` 放到后台运行，并加大 `--timeout`。换会话接着做时，先 `aidraw job show art/jobs/<job>.jsonl` 看做到哪一步。

## 11. 参考文档

| 要做的事 | 读 |
|---|---|
| 命令、参数、输出格式 | [cli.md](references/cli.md) |
| 选工作流、LoRA、预设、尺寸、种子 | [workflows-loras.md](references/workflows-loras.md) |
| 开关卡、等待、处理意见 | [review-gates.md](references/review-gates.md) |
| `art/` 目录、规格、任务日志 | [job-records.md](references/job-records.md) |
| 透明背景、抠图、去白边、预览 | [alpha-and-cleanup.md](references/alpha-and-cleanup.md) |
| 角色立绘 | [recipe-character.md](references/recipe-character.md) |
| 道具与图标 | [recipe-props-icons.md](references/recipe-props-icons.md) |
| 横向可平铺的墙、地、天花板 | [recipe-tileable.md](references/recipe-tileable.md) |
| 序列帧动画（待机、动作），以及用户在「编辑帧」里改过的动画 | [animation.md](references/animation.md) |
| 交付到 Phaser 项目 | [phaser-delivery.md](references/phaser-delivery.md) |

本地脚本在 `scripts/`，运行 `python3 <脚本> -h` 查看参数：

- `sprite_tools.py`：后处理和预览。
- `cutout_compare.py`：全部抠图算法各跑一次，拼出对比图。
- `asset_pack.py`：asset pack 与规格。
- `video_to_sheet.py`：一条命令把视频做成对齐好的精灵图，并登记进项目。
- `edit_to_sheet.py`：把用户在「编辑帧」里导出的精灵图或帧 ZIP 做成同样的精灵图，并登记进项目。

这些脚本都只依赖 Pillow；抽帧另需 ffmpeg，抠图通过 `aidraw` 命令调用后端。

## 12. 禁止事项

- 不部署、不修改 ai-draw，不重启 ComfyUI 或后端。
- 不删除用户的会话或结果；测试会话也要先问。`aidraw round delete` 只能删 agent 自己发的帖子。
- 不往会话里发非素材内容（第 5 节）：更正、状态、游戏截图、`mock` 预览、对比图都在对话里说。
- 不覆盖规格里状态是 `generated` 或 `final` 的素材，除非用户在这一轮明确要求替换。
- 不上传与任务无关的文件；`/uploads` 下的文件不需要登录就能访问。
- 不打印、不转述访问令牌。
