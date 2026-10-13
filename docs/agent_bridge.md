# Agent 接口与审核关卡

让命令行 agent（Claude Code、OpenCode、Codex）用用户自己的账号驱动 ai-draw：生成、把处理结果发进会话，并在关键步骤停下来，请用户在网页里挑选。用户看到的仍然是普通会话：agent 的每次生成都是其中一轮，用户也可以在同一会话里亲自改提示词重画，自己的结果同样能选。

## 组成

| 部分 | 位置 | 说明 |
|---|---|---|
| 个人访问令牌 | `server/agent_bridge/tokens.py`，表 `agent_access_tokens` | `aidp_` 开头，只存 sha256；默认 90 天过期，可吊销 |
| Agent 接口 | `server/api/agent.py`（`/api/agent/*`） | 自检、生成槽、单任务状态、建会话、上传、发结果、审核关卡 |
| 上传目录 | `/uploads/agent/{uid}/{YYYYMM}/` | 原样保存，保留透明和动画；7 天没被引用就清理 |
| 审核关卡 | `server/agent_bridge/gates.py`，表 `review_gates` | 每个会话同时最多一个打开的关卡 |
| 网页 | `frontend/src/features/agent/` | 审核条、「选用」按钮、会话同步、`?session=` 深链接 |
| 命令行 | `tools/aidraw/`，安装为 `/usr/local/bin/aidraw` | 给 agent 用，stdout 输出 JSON |
| 技能 | `skills/aidraw/` | 工作流、配方和本地后处理脚本，软链到 `~/.agents/skills` 和 `~/.claude/skills` |

## 认证

令牌只能在后端容器里生成，密钥不经过 HTTP，也不会进容器日志：

```bash
aidraw auth users                 # 等同于 docker exec … tokens users
aidraw auth setup --user <账号>    # 生成令牌并保存到 ~/.config/aidraw/credentials.json（权限 0600）
aidraw auth revoke                # 吊销
```

`get_user_from_token` 同时接受 JWT 和令牌，所以所有接口和 `/ws?token=` 都能用令牌访问。令牌最后使用时间最多每 10 分钟写一次。命令行默认只连 `http://127.0.0.1:14600`，并拒绝用明文 HTTP 把令牌发给其他主机。

## 接口

| 方法与路径 | 作用 |
|---|---|
| `GET /api/agent/me` | 当前账号 |
| `GET /api/agent/slot` | 生成槽是否空闲；别的用户的任务只显示“忙” |
| `GET /api/agent/tasks/{task_id}` | 单个任务的快照（运行中或 24 小时内结束的），只对所有者可见 |
| `POST /api/agent/sessions` | 建会话，默认值与网页相同，但输入框不预填 agent 的提示词 |
| `POST /api/agent/uploads` | 上传图片或视频，返回自己名下的 `/uploads/agent/...` 地址 |
| `POST /api/agent/rounds` | 把自己名下的媒体作为一轮发进会话（用户消息没有生成方式，不能重新生成） |
| `POST /api/agent/gates` | 开关卡：`question`、`min_picks`、`max_picks`（0 表示只需确认）、`job`、`step`、`replace_open` |
| `GET /api/agent/gates`、`GET /api/agent/gates/{id}` | 查询 |
| `PUT /api/agent/gates/{id}/picks` | 网页更新选用（整表替换） |
| `POST /api/agent/gates/{id}/submit` | 提交：`decision` 为 `approve` 或 `redo`，可带 `note` |
| `POST /api/agent/gates/{id}/cancel` | 撤销 |

生成本身仍然走 `/api/chat/save`（先存用户消息）和 `/api/media/generate`，与网页完全相同；命令行会先等生成槽空闲，上一个任务结束后再让出 20 秒，方便用户手动插队。

## 事件与网页行为

- `agent_session`（`session_created` / `round_posted`）：刷新会话列表；发到当前会话时，重新拉取最新 50 条消息，已加载的更早记录保留。
- `agent_gate`：更新审核条。关卡在别的会话时弹通知，带「前往」按钮。
- 同账号在别处发起的生成（agent 或另一个标签页）：页面空闲时实时接管，显示进度和结果，也可以停止；结束后同步当前会话。
- `https://aidraw.nekocon.cn/?session=<id>`：登录后直接打开该会话。

## 命令行与技能的工作流

具体步骤以 `skills/aidraw/SKILL.md` 为准，这里只记关键约定。这些约定都是用户定的。

- **一个任务一个会话**：会话标题用 `Agent · <项目> <任务>`。过程记在项目的 `art/jobs/<job>.jsonl` 里，换了 agent 会话也能接着做（`aidraw job show`）。
- **结果一出来就开关卡**：`aidraw gen` 和 `aidraw video` 加 `--gate "问题"`，生成一完成就开关卡。不要等 agent 被唤醒再开，也不要先做完后处理再让用户挑。
- **挑完自动交付**：把下面几步串成一条后台命令。用户提交后，agent 不需要再介入。
  1. 等关卡；
  2. 后处理；
  3. 写入项目；
  4. 自检；
  5. 把处理好的素材发回会话，说明写在同一条帖子里；
  6. 开交付后关卡（最多选 1 个）并等待：
     - 不选直接提交：满意；
     - 选用自己的编辑结果：按编辑交付；
     - 重来：按意见重做。
- **会话里只放素材**：会话里只有生成结果、用户的编辑，以及 agent 发的处理好的素材（说明写在同一条帖子里，只写素材本身）。
  - 以下内容在 agent 的对话里说，不发进会话：
    - 只有文字的帖子（更正、状态）；
    - 游戏截图、`mock` 光照预览；
    - 抠图对比图、检查结果。
  - `aidraw post` 必须带素材。发错了就用 `aidraw round delete` 删掉自己那条，它只能删任务日志里记为 agent 发帖的轮次。
- **会话里的问答气泡**：关卡的问答作为对话留在会话里，由后端在开关卡、提交、撤销时自动生成。
  - **提问**：开关卡时，左侧出现 Agent 的提问，注明要选几个；结束后标成“已回答”或“已撤销：原因”。
  - **回答**：用户提交时，右侧出现他的回答：选了哪些（带缩略图）、“满意，直接提交”，或“都不满意，重来：意见”。
  - **是否已读**：回答下面显示“Agent 已收到”或“等待 Agent 读取”。`aidraw gate wait` 读到回答时调用 `POST /api/agent/gates/{id}/ack` 打上标记。
  - **一直没变成“已收到”**：说明没有 agent 在等，要回到对话里叫它。agent 等关卡必须用会唤醒自己的后台任务，不能用脱离会话的进程。
  - **素材帖**：agent 发的素材帖，说明文字显示在 Agent 一侧，和素材放在一起。
- **人工编辑**：
  - **怎么改**：用户在视频那一轮点「编辑帧」，选帧范围和帧率、逐帧修改、背景处理，然后导出精灵图；静态图用「编辑」。编辑结果追加在原来那一轮里。
  - **怎么交给 agent**：在交付后关卡里选用并提交。不在关卡期间编辑的，agent 用 `aidraw round list --job … --user-only` 找到。
  - **agent 怎么处理**：`skills/aidraw/scripts/edit_to_sheet.py` 原样保留用户的帧，只对齐立绘、打包、登记；发现重复帧、循环接缝等问题，在对话里说明并给出选项。
  - **导出记录**：「编辑帧」导出的精灵图在 PNG 的 `ai-draw` iTXt 块里带导出记录（ZIP 里是 `meta.json`）：帧数、网格、帧尺寸、源视频、帧率、每帧在原视频里的时间和尺寸。agent 不用再推算。
- **视频与序列帧**：
  - `aidraw video` 调用 MiniMax H3 首尾帧。`--loop` 让首尾用同一帧，一段视频约 15 分钟。
  - `skills/aidraw/scripts/video_to_sheet.py` 把选中的视频处理成精灵图：
    1. 抽帧，抠图（按帧内容缓存，重跑只抠新帧）；
    2. 去掉开头和结尾的静止帧；
    3. 按静态立绘对齐：比例、脚底、中线不变；动作高过立绘时，帧往上长高并留出头顶空间；
    4. 去掉循环重复的尾帧；
    5. 打包：能排满就不留空格子；
    6. 登记 asset pack（带 `endFrame`）、规格和任务日志。
  - 抽帧按原帧率逐帧解码再按帧号取样，不会重复或跳帧。
- **抠图只用背景处理算法**：不用换色或颜色键（包括后端的 edge 模式）。它们只能去掉和边框相连的背景，手臂和身体之间、两腿之间这类被围住的空隙会残留背景色。
  - `aidraw rmbg` 的 13 种算法与网页「背景处理」的选项和默认参数一致，在 `tools/aidraw/aidraw_cli/cutout.py` 里，要和 `BackgroundOptionsFields.tsx` 保持同步。
  - `cutout_compare.py` 让全部算法各抠一次，拼成品红底和深色底两张对比图。agent 看图挑选（动画在首帧上挑；H3 视频的首帧就是基础帧，所以生成视频时就能挑好），在对话里说明选了几号、为什么，对比图留在本地。用户说“用 #几”就改用那一种。
  - 选定的算法记进项目的 `art/style.md` 和规格的 `source.cutout`。
- **抠图的代价**：
  - 后端容器没有 GPU，抠图跑在 CPU 上，每张几秒到几十秒；rembg 开着 alpha matting 时更慢。
  - 用过的模型常驻后端内存，13 种全部加载约多占 6 GB，重启后端才释放。
  - 第一次用某个模型要先下载。下载卡住时，这个请求要等到命令行的 900 秒超时；`--all` 会把它记为失败，接着跑其余算法。2026-10-12 BiRefNet `dynamic` 和 `matting` 就卡住过。
  - BiRefNet 模型同一时间只加载一个，输入一律转成模型的精度。2026-10-13 两个模型同时加载，之后所有 BiRefNet 抠图都报 Half/float 不一致，只能重启后端。
  - 本地文件以 data URL 发送，不会在 `/uploads/agent` 里留副本。

## 数据与清理

- 两张新表由启动时的 `create_all()` 创建，不改动已有表。
- `review_gates.session_id` 外键 `ON DELETE CASCADE`：删除会话时，关卡一并删除。
- 选用必须指向本会话里的 `generated_images`；提交时重新校验，已删除的结果不能提交。关卡里的选用不阻止文件清理。
- `agent` 目录在 `USER_SCOPED_ROOTS` 里：地址里的用户 ID 就是归属；会话删除、单张删除时按现有规则清理没有引用的文件。

## 测试

```bash
docker run --rm --network none -v /opt/ai-draw:/src -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  ai-draw-ai-draw-backend:latest python -B -m unittest discover -s tests -p "test_*.py"
npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run build
python3 -B -m unittest discover -s tools/aidraw/tests
python3 -B -m unittest discover -s skills/aidraw/scripts/tests
```

后端相关测试：`tests/test_agent_tokens.py`、`test_agent_uploads.py`、`test_agent_rounds.py`、`test_agent_gates.py`、`test_generation_tasks.py`。前端：`frontend/tests/agent*.test.ts` 和 `generationEvents.test.ts`。

## 回退

改动都是新增的。回退时切回之前的提交并重新部署即可；两张新表留在数据库里也不影响旧代码。
