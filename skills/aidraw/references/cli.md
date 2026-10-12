# aidraw 命令行

`aidraw` 在宿主机上运行（源码在 `/opt/ai-draw/tools/aidraw/`），默认连 `http://127.0.0.1:14600`，网页链接用 `https://aidraw.nekocon.cn`。
stdout 只输出一个 JSON 对象，进度写在 stderr；加 `--quiet` 可以关掉进度。退出码见 SKILL.md。

## 认证与自检

```bash
aidraw auth users                       # 列出 ai-draw 账号（在后端容器里执行）
aidraw auth setup --user <账号>          # 生成个人访问令牌（默认 90 天），保存到 ~/.config/aidraw/credentials.json（0600）
aidraw auth status                      # 令牌对应的账号、前缀、到期时间
aidraw auth revoke                      # 吊销并删除本机令牌
aidraw doctor                           # health / token / service / slot / workflows / loras / cache
```

## 会话

```bash
aidraw session new --title "Agent · classroom 主角立绘"   # → {session_id, link}
aidraw session list --limit 10
aidraw session link <session_id>
```

用户在会话里发消息后，ai-draw 可能会重新总结标题；后续一律以 `session_id` 为准。

## 生成

```bash
aidraw gen --session S --prompt "…" [--ref 文件或/uploads地址 ...] [--lora Sen:0.6 ...] \
  [--count 4] [--size 768x1024] [--seed 123] [--steps 40] [--ref-res 1024] [--preset pose] \
  [--workflow t2i|i2i|gpt|<完整ID>] [--option key=value ...] \
  [--out art/work/heroine/candidates] [--job art/jobs/heroine.jsonl --step candidates] [--timeout 540]
```

- 不给 `--workflow` 时，没有参考图走 `qwen_image_21_t2i`，有参考图自动换成 `qwen_image_21_i2i`。
- `--ref` 的顺序就是提示词里 `<image1>`、`<image2>`（或 `@图片1`）的顺序。本地文件会先上传；带透明通道的默认铺白底（`--flatten '#ffffff'`），因为 ComfyUI 会丢掉 alpha；`--keep-alpha` 关闭铺底。
- `--size` 给了就按这个尺寸出图；Qwen 编辑不给尺寸时，输出跟参考图 1 一样大。
- `--seed N`：第 n 张用 N+n−1。同一种子加同一参数可以复现结果。
- `--prompt-file` 适合长提示词；`--preset` 的 ID 从 `aidraw presets` 查。
- 流程：本地校验 → 上传参考图 → 等生成槽空闲（并在上一个任务结束后让出 20 秒）→ 记录用户消息 → 提交 → 轮询 → 下载结果。

成功输出：

```json
{"ok": true, "status": "completed", "session_id": "…", "message_id": "msg-…", "reply_id": "msg-…-reply",
 "task_id": "…", "images": [{"index": 0, "url": "/uploads/generated/1/…png", "seed": 1234,
 "file": "art/work/…/1a2b3c4d_00_s1234.png", "width": 768, "height": 1024, "has_alpha": false}],
 "link": "https://aidraw.nekocon.cn/?session=…", "elapsed_s": 231.4}
```

同目录还会写一个 `<消息前8位>.json` 旁注文件，记录请求参数和结果。

超时（退出码 2）时输出带 `resume`，例如 `aidraw wait <task_id> --session S --message msg-…-reply`，照着运行就能接着等并下载。

## 视频（MiniMax H3 首尾帧）

```bash
aidraw video --session S --first base.png [--last end.png | --loop] [--duration 4|5|6|8|10|12|15] [--seed N] \
  [--preset video_transition] --prompt-file prompt.txt [--out DIR] [--job … --step …] [--timeout 2700]
```

- `--loop` 把首帧也当作尾帧，生成首尾相接、能循环的视频；透明首尾帧默认铺白底。
- 输出 24 fps 的 mp4，下载到 `--out`；每段通常 5–15 分钟，超时用输出里的 `resume` 续等。
- 抽帧和做精灵图见 animation.md。

## 读取一轮、发回处理结果

```bash
aidraw round get --session S --message msg-…-reply [--out DIR]
aidraw post --session S --text "去白边并缩放到 340 高的成品；右边是游戏光照预览" \
  --file art/work/heroine/final.png --file art/work/heroine/mock.png [--url /uploads/…] [--job … --step deliver]
```

`post` 原样上传文件（保留透明和动画，PNG/JPEG/WebP/GIF/MP4/WebM，单个不超过 100 MB），然后作为一轮显示在会话里。顺序是先 `--file`，再 `--url`。

## 审核关卡

```bash
aidraw gate open --session S --question "选一张作为侧视基准图：朝右、全身、脚完整" --max 1 \
  [--min 1] [--round msg-…-reply] [--replace] [--job art/jobs/heroine.jsonl --step pick-side-view] [--wait]
aidraw gate wait <gate_id> [--timeout 540] [--download art/work/heroine/picked]
aidraw gate get <gate_id>
aidraw gate list [--session S] [--status open]
aidraw gate cancel <gate_id> --reason "用户在对话里回答了"
aidraw gate submit <gate_id> --decision approve --pick /uploads/… --note "用户在对话里说：选 3"
```

- `--max 0` 表示只需确认，网页上的按钮显示为「通过」。
- `--replace` 会撤销这个会话里还开着的关卡；不加时，已有打开的关卡会返回 409。
- `gate wait` 的结果：

```json
{"ok": true, "gate_id": "gate-…", "status": "submitted", "decision": "approve", "note": "脸再圆一点",
 "picks": [{"url": "/uploads/…", "message_id": "msg-…-reply", "image_index": 2, "seed": 1236, "file": "…"}]}
```

`decision` 为 `redo` 时 `picks` 可能为空；状态为 `cancelled` 时退出码是 4。

## 媒体工具

```bash
aidraw upload a.png b.gif [--flatten '#ffffff']                    # → /uploads/agent/… 地址
aidraw rmbg 文件或/uploads地址... [--variant birefnet-toonout | --all] [--out DIR]   # 背景处理算法；--list 列出 13 种
aidraw upscale 文件或/uploads地址 [--method realesrgan_anime] [--scale 2|4] [--out DIR]
aidraw slot                                                        # 生成槽是否空闲
aidraw stop [--task ID]                                            # 停止自己账号的任务（先问用户）
aidraw workflows | aidraw loras | aidraw presets [--workflow ID]
aidraw job show art/jobs/heroine.jsonl                             # 读任务日志
```

抠图只用后端的背景处理算法：InSPyReNet、BiRefNet、rembg 共 13 种，参数和网页一致，没有换色或颜色键。
- `--all`：每种算法各抠一次，结果文件名带算法名；某个算法失败只记 `error`，不影响其他算法。一般用 `cutout_compare.py`，它会顺带拼出对比图。
- 多个文件配一个 `--variant`：保持原文件名，适合一组帧。
- 本地文件以 data URL 发送，不在 `/uploads` 留副本。
- 跑在后端 CPU 上，每张几秒到几十秒；某个模型第一次用时要先下载。

放大同一时间只能跑一个，忙时命令会自动重试。
