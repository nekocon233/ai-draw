---
name: aidraw
description: "用本机 ai-draw（https://aidraw.nekocon.cn）为游戏或其他项目生成、处理图片素材，并在 ai-draw 网页里让用户预览、选用、写意见后再继续。覆盖文生图、参考图生图（可叠 LoRA）、GPT Image 编辑、抠图、放大、把处理结果发回会话、按项目规格交付。用户说“用 ai-draw 出图”“AI 生图”“做立绘/道具/图标/可平铺背景”“换正式美术”“用 LoRA 画”“在 ai-draw 里挑图”时使用。"
---

# ai-draw 生图工作流

本技能供 Claude Code、OpenCode、Codex 共用。agent 用 `aidraw` 命令驱动本机 ai-draw；用户在 ai-draw 网页里看结果、点「选用」、写意见，再点「提交给 Agent」或「都不满意，重来」。所有生成都记成网页会话里的一轮，用户随时可以在同一会话里亲自改提示词重画、编辑、抠图，他自己的结果同样可以被选用。

## 1. 适用范围

- 能做：Qwen-Image-2.1 文生图和参考图生图（可叠 LoRA）、GPT Image 编辑、后端抠图和放大、本地后处理（`scripts/`）、把成品和预览图发回会话、开审核关卡等用户决定。
- 暂不提供命令：视频和序列帧（MiniMax H3 首尾帧、动作参考、抽帧）。这部分属于第二阶段；用户急需时，说明可以先在网页里用 H3 和「帧导出」手动做。
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
| `auto` | agent 自己挑，只在最后交付前请用户确认 |
| `key`（默认） | 风格定调、选候选、确认成品，三处 |
| `every` | 每次生成或处理后都停 |

## 4. 标准流程

1. 读规格，建会话：`aidraw session new --title "Agent · classroom 主角立绘"`，把返回的 `link` 发给用户。
2. **风格定调**（项目还没有 `art/style.md` 时才做）：同一描述分别用不挂 LoRA 和两三个候选 LoRA 各出 2 张，开关卡请用户选，把结论（LoRA、强度、风格描述、禁用词）写进 `art/style.md`。
3. **出候选**：`aidraw gen`，每批不超过 4 张。参考图、LoRA、种子见 [workflows-loras.md](references/workflows-loras.md)，具体素材看对应配方。
4. **自查**：结果下载到本地后，先用 `scripts/sprite_tools.py contact` 拼成编号图自己看一遍。剔掉朝向错、缺手脚、多余文字、背景不干净的；全部不合格就调整后重出，不要把废片交给用户挑。
5. **开关卡**：`aidraw gate open --session S --question "…" --max N`，告诉用户链接、要选几个、看什么。等待方式见 [review-gates.md](references/review-gates.md)。
6. **按结果走**：`approve` 就用选中的图继续；`redo` 读 `note` 调整后重来；关卡被撤销或用户在对话里改了主意，以对话为准。
7. **后处理**：抠图、去白边、缩放到规格尺寸，做棋盘格和游戏光照预览（[alpha-and-cleanup.md](references/alpha-and-cleanup.md)）。用 `aidraw post` 把成品和预览发回会话，再开一个只需确认的关卡（`--max 0`）。
8. **交付**：按项目流程写入文件、更新规格和 asset pack、自检，再交给用户在项目里验收（[phaser-delivery.md](references/phaser-delivery.md)）。

## 5. 和用户协作

- 每次开关卡都给出会话链接，说清楚：要选几张、判断标准是什么、可以写什么意见。
- 告诉用户可以直接在同一会话里干预：改提示词重画、编辑、设为参考；他自己画的结果也能选用。
- 用户在对话里直接回答（例如“选 3，脸再圆一点”）也算数：用 `aidraw gate submit` 原样记录他说的选择，或者用 `aidraw gate cancel --reason` 撤销关卡后按对话继续。不要替用户做没说过的决定。
- 关卡上的“通过”只代表这一步的选择，不等于项目验收。项目自己的验收和提交规则照旧。

## 6. 共享生成槽

- 整台 ai-draw 同一时间只能跑一个生成任务，用户手动生成也用这一个槽。`aidraw gen` 会先排队，每两个任务之间让出 20 秒，方便用户插队。
- 每批不超过 4 张（Qwen 1024² 约 55 秒一张）；大批量先问用户。
- 用户在网页里能看到并停止 agent 的任务。被停止时命令返回退出码 4，并保留已完成的结果；重新提交前先问用户。

## 7. 质量红线（游戏素材）

- 朝向、锚点、尺寸以项目规格为准；角色脚底贴画布底边，左右居中。
- 只画固有色：不画投影、光斑、暗角、雾气、颗粒（游戏的光照和后期会叠加上去）。
- 透明边缘干净：没有白边、灰边、残留背景块。要在亮、暗两种底上都检查。
- 缩到交付尺寸后线宽一致（通常 2 px 左右）；同一场景的道具缩放倍数要接近。
- 不用 `sketch_finish`（参考图成品化）预设做游戏素材：它要求画明暗和接触阴影。
- 画面里不要出现水印、签名、乱码文字；需要文字时（门牌、标志）先确认规格要求文字是否由代码绘制。

## 8. 失败与续跑

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

## 9. 参考文档

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
| 交付到 Phaser 项目 | [phaser-delivery.md](references/phaser-delivery.md) |

本地脚本在 `scripts/`：`sprite_tools.py`（后处理和预览）、`asset_pack.py`（asset pack 与规格）。两者都只依赖 Pillow，运行 `python3 <脚本> -h` 查看子命令。

## 10. 禁止事项

- 不部署、不修改 ai-draw，不重启 ComfyUI 或后端。
- 不删除用户的会话或结果；测试会话也要先问。
- 不覆盖规格里状态是 `generated` 或 `final` 的素材，除非用户在这一轮明确要求替换。
- 不上传与任务无关的文件；`/uploads` 下的文件不需要登录就能访问。
- 不打印、不转述访问令牌。
