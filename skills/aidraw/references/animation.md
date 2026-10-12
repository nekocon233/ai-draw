# 配方：序列帧动画（以待机循环为例）

思路：用 MiniMax H3 的首尾帧模式，首帧和尾帧都用同一张立绘（`aidraw video --loop`），模型补出中间的动作，视频天然首尾相接；再抽帧、逐帧抠图（ai-draw 的背景处理算法）、用同一个框裁切缩放，打包成 Phaser 精灵图。

下面的 `$S` 指 `<技能目录>/scripts/sprite_tools.py`。

## 1. 首尾帧画布

- 用最高清的立绘源图（例如原型图或定稿前的大图），按原尺寸放到白底画布上，不要缩放。
- 画布用 H3 支持的比例：竖向角色用 9:16，即 768×1344；“自动画幅”会按首帧比例取，短边 768。
- 人物左右居中；脚底离下边约 10%，头顶上方留出头发、手臂摆动的空间。
- **记下人物在画布里的位置**：之后裁切帧时要用同一套取景，才能和游戏里的静态立绘严丝合缝（同样的帧高、同样的脚底行、同样的中线）。

## 2. 生成视频（每段 5–15 分钟）

```bash
aidraw video --session S --first base_frame.png --loop --preset video_transition --duration 4 --seed 20261012 \
  --prompt-file prompt.txt --out art/work/<job>/videos --job art/jobs/<job>.jsonl --step video-20261012 --timeout 2700
```

- 提示词要点：固定镜头、背景始终纯白、动作幅度小、双脚始终不动、不转身不走动、保持画风线条配色不变、结尾回到开头的姿势。待机写清具体动作，例如呼吸起伏、眨一次眼、头发和裙摆轻摆。
- 出 2 段不同种子的视频，两条命令写进同一条后台命令，第二条加 `--gate "选一段待机视频…"`：最后一段生成完就立刻开关卡，用户在网页里直接播放视频来挑。
- **视频生成期间选好抠图算法**：H3 的第一帧就是基础帧，所以在基础帧上跑 `cutout_compare.py`（见 alpha-and-cleanup.md），自己看对比图选定算法，不用等用户挑视频。
- **串成一条后台命令**：“等关卡 → 用选中的视频跑 `video_to_sheet.py --cutout <算法>` → 写帧率 → 自检 → `aidraw post` 把动画预览和抠图对比图发回会话（不开关卡）”。用户一提交就自动交付，不用等 agent 处理。
- 生成槽同一时间只能跑一个任务；两段视频依次排队，用户手动生成会插在中间。

## 3. 一条命令出精灵图（推荐）

用户选定视频后，抽帧、抠图、对齐、打包、登记全部由 `video_to_sheet.py` 完成，不需要逐步操作：

```bash
python3 <技能目录>/scripts/video_to_sheet.py video.mp4 -o public/assets/characters/heroine_idle.png \
  --work art/work/<job>/<视频> --match public/assets/characters/heroine.png \
  --cutout birefnet-toonout --sample-fps 8 --play-fps 8 \
  --pack public/assets/asset-pack.json --key heroine_idle --section characters \
  --spec art/spec.json --job art/jobs/<job>.jsonl
```

- `--match`：给出静态立绘，帧高、脚底行和中线都和它一致，游戏里在待机和静态图之间切换不会跳。
- `--cutout`：在基础帧上对比后选定的算法，所有帧都用它抠图。抠图在后端 CPU 上跑，每帧几秒到几十秒，30 多帧要几分钟。
- `--sample-fps` 决定帧数（4.5 秒、8 fps 约 36 帧）；`--play-fps` 生成对应播放速度的 WebP 预览，第一个值写进规格。
- 循环：首尾帧几乎一样时自动去掉尾帧（`loop_trimmed`）。输出里的 `feet_bottom` 应该只差 0–1 px，差得多说明模型挪动了人物，换一段视频。
- 不加 `--pack/--spec/--job` 时只出精灵图和预览，适合给用户挑之前先预处理。

**用户只挑视频**：

- 用 `aidraw video --gate`，视频一生成完就开关卡，用户直接播放挑选。
- 抠图算法由 agent 在基础帧上对比选定；播放速度默认 8 fps。
- 交付后发回会话的预览里写明当前帧率和抠图算法。用户想换速度或换算法，在对话里说一声即可：改帧率配置，或者换 `--cutout` 重跑命令，不用重新出视频。
- 要给用户比较速度，就用 `--play-fps 6,8,10` 出三份预览，第一个值写进规格。

## 4. 接入游戏

- 帧高与静态立绘的贴图高度一致时，游戏里的缩放比例不变，切换动画和静态图不会跳。
- Phaser：`scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(sheetKey), frameRate, repeat: -1 })`，站着时 `sprite.play(key, true)`，走动时 `anims.stop()` 并换回静态贴图。每种新动作只需要写一次代码；以后重做同一个动作，只要重新跑上面的命令。写代码前读 `node_modules/phaser/skills/animations/SKILL.md`。
- 纹理别太大：单边不超过 4096 px（命令默认按 4096 换行）。
- 需要单独调某一步时：抠图用 `aidraw rmbg <帧…> --variant <算法> --out <目录>`；其余步骤用 `sprite_tools.py` 里的 `extract`、`crop-frames`、`loop-scan`、`pack-sheet`、`anim-preview`。

## 5. 确认与交付

- 命令已经登记了 asset pack、规格（kind=animation、帧数、帧率、帧尺寸、来源视频、抠图算法）和任务日志。
- 提醒用户去 phaser-dev 实际看（静态截图看不出动作）；需要调速度时改项目里的帧率配置即可，不用重新出图。
