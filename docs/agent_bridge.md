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
