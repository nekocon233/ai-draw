# 项目里的美术记录

技能本身不存项目数据。每个项目在自己的仓库里放：

```
art/
  spec.json          每个贴图 key 的交付规格和状态（提交到 git）
  style.md           风格定调的结论（提交到 git）
  jobs/<job>.jsonl   任务日志：每次生成、发帖、关卡一行（提交到 git，体积很小）
  work/              下载的候选、中间文件、预览（加进 .gitignore）
```

## spec.json

先用脚本生成骨架，再逐项补全：

```bash
python3 <技能目录>/scripts/asset_pack.py spec-init --pack public/assets/asset-pack.json --root public --project <项目名> -o art/spec.json
```

每个 key 的字段（骨架只有前几项，其余由 agent 按代码补全，并请用户确认；下面的注释只为说明，文件里不能写注释）：

```jsonc
"heroine": {
  "path": "public/assets/characters/heroine.png",
  "kind": "character",                 // character / prop / item / tile / fx / ui
  "size": {"w": "auto", "h": 340},     // 交付的贴图像素尺寸；auto 表示由内容决定
  "display_height": 230,               // 游戏里的显示高度（代码里缩放）
  "origin": [0.5, 1],
  "facing": "right",
  "alpha": true,
  "layer": "player",                   // 图层；emissive 层不受光照压暗
  "tile_x": false,
  "bands": null,                       // 平铺条带里必须对齐的水平线，如 {"trim": [286, 296]}
  "code_refs": ["src/config/tuning.ts player.displayHeight", "src/scenes/Title.ts setScale(300 / 340)"],
  "notes": "朝右；不画投影（代码画椭圆）",
  "ai": true,                          // false：技术性贴图（光斑、噪点），不用 AI 画
  "status": "placeholder",             // placeholder → generated → final
  "source": null                       // 交付时写入 {job, session, message, url, seed, sha256}
}
```

修改字段用 `asset_pack.py spec-set art/spec.json heroine status=generated 'source={"job":"heroine",...}'`；检查交付用 `asset_pack.py check --spec art/spec.json --root . --pack public/assets/asset-pack.json [key...]`。

状态的含义：

- `placeholder`：还是占位图，可以覆盖。
- `generated`：已交付 AI 生成的版本，正在等项目验收；替换前要问用户。
- `final`：用户验收通过；除非用户明确要求，否则不再动。项目里生成占位图的脚本必须跳过这些 key。

## style.md

风格定调后写下来，后续生成照抄：

```markdown
# 美术风格
- LoRA：Sen:0.6（风格定调会话：<链接>，日期）
- 风格描述：手绘墨线，线条略抖，平涂，少量赛璐璐阴影，配色低饱和……
- 每次都加：纯白色背景，无阴影，无地面，平光，无文字，无水印
- 禁止：写实、厚涂、景深、光晕、强烈明暗
- 角色参考图：prototype_art/character_prototype.png（以及定稿后的侧视基准图）
- 交付后的线宽：约 2 px
```

## 任务日志

`aidraw` 的 `--job` 会自动追加记录：`gen_submitted`、`gen`、`gen_failed`、`post`、`gate_open`、`gate_result`、`round_deleted`（删掉自己发的帖子）。

- 任务日志也是区分“agent 的媒体”和“用户的编辑”的依据：`gen` 和 `post` 里的地址是 agent 的，会话里其余的媒体都是用户的（`aidraw round list --job … --user-only`）。
- `video_to_sheet.py`、`edit_to_sheet.py` 会追加 `deliver` 记录；人工编辑的 step 是 `user-edit`，规格里对应写 `source.edited_by_user`。

agent 自己做的其他本地处理和交付也追加一行，方便复现：

```bash
python3 - <<'PY'
import json, datetime
record = {"ts": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "event": "deliver",
          "step": "deliver", "key": "heroine", "file": "public/assets/characters/heroine.png",
          "from": "art/work/heroine/final.png", "cutout": "birefnet-toonout",
          "commands": ["cutout_compare.py …", "sprite_tools.py fit …"]}
open("art/jobs/heroine.jsonl", "a", encoding="utf-8").write(json.dumps(record, ensure_ascii=False) + "\n")
PY
```

接手时先 `aidraw job show art/jobs/<job>.jsonl`：最后一条 `gate_result` 说明用户已经定了什么，最后一条 `gen` 告诉你会话、种子和参数。
