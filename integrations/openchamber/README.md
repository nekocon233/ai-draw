# ai-draw 的 OpenChamber 扩展

在 OpenChamber 里挑 ai-draw 的审核关卡，不用切到 ai-draw 网页。

- **对话的 Work Status 里的「ai-draw 待选」**：
  - 显示本项目最新的一个关卡：问题、要选几个、候选缩略图（视频悬停播放）。
  - 可以直接「提交」或「都不满意，重来」。点「重来」会先展开意见框，写好再点「确认重来」。
  - 有新关卡时弹一次通知，侧栏的 ai-draw 图标上显示待选数。
- **侧栏的 ai-draw 面板**：
  - 列出所有待选关卡，本项目的排前面，其他项目的标出来。
  - 每个关卡先显示关卡建议的那一轮，「显示更早的结果」可以从会话里更早的轮次里选。点 ⤢ 看大图。
  - 列出刚提交的、正在生成的（阶段、已用时间），以及本项目的素材任务（读 `art/jobs/*.jsonl`）。
  - 点「本项目的素材任务」标题可以整块收起或展开，标题保留任务数。首次默认展开，按项目记住选择，刷新或重新打开面板后恢复。
- **提交走的是和 ai-draw 网页相同的接口。** agent 在后台运行的 `aidraw gate wait` 照常收到回答，ai-draw 会话里照常留下问答气泡和“Agent 已收到”。
- **编辑帧、编辑、自己改提示词重画还在 ai-draw 网页里做。** 点「打开会话」或「在浏览器标签打开」，对应会话直接显示在 OpenChamber 的浏览器标签里。同一项目里每个会话复用自己的标签；「新窗口」用系统浏览器打开。

## 安装

1. **生成一个专给 OpenChamber 用的令牌**。不要和命令行共用，这样可以单独吊销：

   ```bash
   docker exec -i ai-draw-backend python -B -m server.agent_bridge.tokens create --user <账号> --name openchamber --days 0
   ```

   令牌只在输出里出现这一次。
2. **安装扩展**：OpenChamber「设置 → 扩展 → 添加」，填目录 `/opt/ai-draw/integrations/openchamber`，然后批准它要的权限：
   - 读项目文件（files）：只读 `art/jobs/`。
   - 网络（network）：通过 OpenChamber 服务器代调 ai-draw 接口。
   - 外部来源（origins）：显示 `https://aidraw.nekocon.cn` 上的图片和视频。
3. **粘贴令牌**：「设置 → 集成 → ai-draw」，粘贴第 1 步的令牌。令牌只存在 OpenChamber 服务器上，扩展页面拿不到。
4. **吊销令牌**：

   ```bash
   docker exec -i ai-draw-backend python -B -m server.agent_bridge.tokens list --user <账号>
   docker exec -i ai-draw-backend python -B -m server.agent_bridge.tokens revoke --prefix <前缀>
   ```

## 行为细节

- **轮询**：面板或区块开着时，每 3 秒拉一次开着的关卡；页面在后台时改成 15 秒。候选每 15 秒重拉一次，用户在 ai-draw 里编辑后追加到原轮次的图，也会出现在候选里。
- **只在开着时提醒**：面板和区块都关着时，扩展不运行，不会弹通知，这时只能靠 agent 在对话里提醒。
  - 弹过通知的关卡记在扩展存储里，同一个关卡只通知一次。
  - 侧栏面板开着时不弹通知，只把关卡记为已看过。
- **选用同步到 ai-draw**：选中的结果会同步过去（`PUT /picks`），ai-draw 网页上看到的是同一份选择。在网页上改了选择，这边也会跟着变。
- **必须写意见才能重来**：不写，agent 不知道该改什么。
- **401 会断开连接**：ai-draw 只要对某个请求回了 401，OpenChamber 就会删掉保存的令牌，面板会提示重新粘贴。
- **浏览器支持**：网页版和 Electron 桌面版需要支持 `host.openBrowser` 的 OpenChamber。旧宿主、VS Code 和移动端会提示不支持；没有打开项目时会提示先打开项目。
- **折叠状态**：保存在当前 OpenChamber 服务器的扩展存储中，按项目目录区分。保存失败时仍可折叠，但会提示重新打开后可能需要再收起一次。

## 开发

```bash
NODE_ENV=development bun install   # 本机 NODE_ENV=production，不设置会跳过开发依赖
bun run build                      # panel/main.ts → panel/main.js（IIFE，要提交）
bun run typecheck
bun test tests/                    # 纯逻辑 + 在 happy-dom 里用模拟宿主跑打包好的 main.js
bun tests/live.e2e.ts              # 对真实 ai-draw 的端到端测试
```

**真实端到端测试**：
- 会建一个临时会话「Agent · 测试 OpenChamber 面板」，转发两张已有的图，在模拟宿主里走一遍选用、只需确认、写意见重来，由 `aidraw gate wait` 读回答，最后删掉会话。
- 不生成图片，也不占生成槽。
- 用的是命令行的令牌（`~/.config/aidraw/credentials.json`）。

**更新已安装的扩展**：目录安装直接从这个目录运行。改完代码重新 `bun run build`，再在 OpenChamber 里重新打开面板即可。

修改本地 SDK 后，先在 `/opt/openchamber` 运行 `bun run --cwd packages/sdk build`，再在本扩展目录运行 `NODE_ENV=development bun install --force` 更新 `file:` 依赖，最后重打包扩展。浏览器接口的宿主实现需要同时构建 OpenChamber 网页包。

| 文件 | 内容 |
|---|---|
| `package.json` | manifest：面板、Work Status 区块、令牌集成、批准的来源 |
| `panel/api.ts` | 调用 ai-draw 的 agent 接口（`docs/agent_bridge.md`） |
| `panel/model.ts` | 纯逻辑：候选排序和编号、选用规则、任务日志 |
| `panel/view.ts` | 关卡卡片、候选格子、大图 |
| `panel/main.ts` | 状态、轮询、提醒、提交 |
| `tests/host.ts` | 模拟 OpenChamber 宿主 |
