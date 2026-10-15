# 配方：序列帧动画（以待机循环为例）

**做法**：

1. 用 MiniMax H3 **只放首帧参考图**生成持续动作的视频：`--first base_frame.png --preset video_motion`。循环素材不放尾帧，也不加 `--loop`。
2. 抽帧，逐帧抠图（用 ai-draw 的背景处理算法）。
3. 从视频中找出完整、首尾接得上的动作循环，用同一个框裁切、缩放所有帧，打包成 Phaser 精灵图。

尾帧约束会促使模型提前回到指定姿势；短视频容易在后半段固定不动，4 秒视频可能只有前半段有动作。生成时让动作持续，循环接缝在抽帧后处理。只有用户明确要从指定首帧过渡到指定尾帧时，才用 `--last` / `--loop` 和 `video_transition`。

用户想自己改时，在网页的「编辑帧」里改完导出，agent 用同一套取景接着交付（第 4 节）。

下面的 `$S` 指 `<技能目录>/scripts`。

## 1. 首帧画布

- 用最高清的立绘源图（例如原型图或定稿前的大图），按原尺寸放到白底画布上，不要缩放。
- 画布用 H3 支持的比例：竖向角色用 9:16，即 768×1344；“自动画幅”会按首帧比例取，短边 768。
- 人物左右居中；脚底离下边约 10%，头顶上方留出头发、手臂摆动的空间。
- **记下人物在画布里的位置**：之后裁切帧时要用同一套取景，才能和游戏里的静态立绘严丝合缝（同样的比例、脚底行和中线）。

## 2. 生成视频（每段 5–15 分钟）

```bash
aidraw video --session S --first base_frame.png --preset video_motion --duration 4 --seed 20261012 \
  --prompt-file prompt.txt --out art/work/<job>/videos --job art/jobs/<job>.jsonl --step video-20261012 --timeout 2700
```

- **提示词要点**：
  - 固定镜头，背景始终纯白；
  - 动作幅度适中，双脚始终不动，不转身、不走动；
  - 保持画风、线条、配色不变；
  - 动作持续到视频结束，自然重复，不提前做完后停住；
  - 写清具体动作，例如呼吸起伏、眨一次眼、头发和裙摆摆动。

  动作太小在游戏里看不出来，可以出两段不同风格的让用户挑（例如平静一段、紧张一段）。
- **出 2 段不同种子的视频**：两条命令写进同一条后台命令，第二条加 `--gate "选一段待机视频…"`，最后一段生成完就立刻开关卡，用户在网页里直接播放视频来挑。
  - 两条命令只有种子不同，第二段会追加到第一段那一轮，两段在同一个气泡里，关卡也落在这一轮。
  - 种子用连续的 S、S+1：这一轮显示的“固定种子 S”就和网页的约定一致（第 n 个结果用 S+n−1）。
- **视频生成期间选好抠图算法**：H3 的第一帧就是基础帧，所以在基础帧上跑 `cutout_compare.py`（见 alpha-and-cleanup.md），自己看对比图选定算法，不用等用户挑视频。对比图留在本地，选择在对话里说。
- **串成一条后台命令**，用户提交后不用等 agent 回复：
  1. 等挑视频的关卡；
  2. 用 `video_to_sheet.py --cutout <算法>` 出精灵图并登记，按需同步项目里的帧率配置；
  3. 跑项目自检；
  4. `aidraw post` 发精灵图动画（棋盘格底的预览），说明写在同一条帖子里：帧数、帧率、抠图算法、保留了视频的哪一段；
  5. 开交付后关卡（`aidraw gate open --min 0 --max 1`）并等待：
     - 不选直接提交：结束；
     - 选用了编辑结果：`edit_to_sheet.py` → 自检 → `post` → 再开交付后关卡；
     - 「都不满意，重来」：退出，由 agent 读意见。

  检查结果和游戏里的样子由 agent 在对话里报告，不发进会话。
- **生成槽**：同一时间只能跑一个任务，两段视频依次排队，用户手动生成会插在中间。

## 3. 一条命令出精灵图

用户选定视频后，抽帧、抠图、对齐、打包、登记全部由 `video_to_sheet.py` 完成：

先确定循环范围：可以先 `sprite_tools.py extract` 抽帧，再用 `loop-scan` 排序首尾相近的区间。结合预览选择包含一个完整动作的区间，不能只挑静止段。按选定范围给下面的命令加 `--start <秒> --end <秒>`；保留的实际时间范围记入规格和素材说明。步行要截一轮完整的两步，并检查脚底、人物漂移及首尾接缝。

```bash
python3 $S/video_to_sheet.py video.mp4 -o public/assets/characters/heroine_idle.png \
  --work art/work/<job>/<视频> --match public/assets/characters/heroine.png \
  --cutout birefnet-toonout --sample-fps 8 --play-fps 8 \
  --pack public/assets/asset-pack.json --key heroine_idle --section characters \
  --spec art/spec.json --job art/jobs/<job>.jsonl
```

**参数**：

- `--match`：比例、脚底行和中线都和静态立绘一致。
  - 有帧高过立绘顶部时（例如深呼吸抬起的头发），帧会往上长高，最高处再留 `--headroom` 像素（默认 4），不会被截掉。
  - 脚底和比例不变，游戏里在待机和静态图之间切换不会跳。
- `--trim-still auto`（默认）：开头、结尾只是停住不动的帧会自动去掉，输出里的 `trimmed_still` 记着去掉了几帧。
  - 它只去静止帧，不会自动找到完整循环，也不保证末帧回到起始姿势；仍需先选循环范围、检查接缝。
  - 确实需要停顿时用 `--trim-still none`。
- `--cutout`：在基础帧上对比后选定的算法，所有帧都用它抠图。
  - 抠图在后端 CPU 上跑，每帧几秒到几十秒。
  - 结果按帧内容缓存在 `work/cut-cache/`。同一段视频改 `--start/--end`、`--headroom`、`--sample-fps` 后重跑，只有新出现的帧才需要抠，几秒就能重出。
- `--sample-fps` 决定帧数（4.5 秒、8 fps 约 36 帧）；`--play-fps` 生成对应播放速度的 WebP 预览，第一个值写进规格。

**输出**：

- **排版**：能排满就选不留空格子的列数。登记 asset pack 时总写 `endFrame = 帧数 − 1`，空格子不会被当成帧（否则人物每轮循环会消失一下）。
- **循环**：首尾帧几乎一样时自动去掉重复的末帧（`loop_trimmed`）；这只是去重复，不会把任意视频变成无缝循环。预览至少连续播放三轮，检查接缝和异常停顿。
- **脚底**：`feet_bottom` 应该只差 0–1 px。差得多说明模型挪动了人物，换一段视频。
- **只出图**：不加 `--pack/--spec/--job` 时只出精灵图和预览，适合先预处理、再给用户挑。

**用户在对话里调参数**：都不用重新出视频，有缓存时几秒就能重出。

| 用户说 | 做法 |
|---|---|
| 去掉后面的静止帧、动作前面停太久 | 默认已经去掉；还有的话用 `--end <秒>` / `--start <秒>` 截掉 |
| 头顶被截、上面多留点 | 把 `--headroom` 调大 |
| 快一点、慢一点 | 改项目里的帧率配置；要比较就用 `--play-fps 6,8,10` 出三份预览 |
| 换抠图、“用 #几” | 换 `--cutout` 重跑。新算法第一次要逐帧抠 |

## 4. 人工编辑（编辑帧）

**用户这样改**：

1. 在视频那一轮点「编辑帧」，可以做这些：
   - 选帧范围和帧率：建议用视频原帧率，结尾停在接近起始姿势的地方，循环才顺；
   - 逐帧修改；
   - 背景处理：建议用项目选定的算法。

   裁切、改格子尺寸也可以，agent 会改按立绘对齐。
2. 导出「精灵图」，导出的图会追加在这一轮里。
3. 在交付后关卡里选用导出的图，再提交。如果没有打开的关卡，就在对话里说一声。

**agent（或后台命令）接着运行**：

```bash
python3 $S/edit_to_sheet.py <下载的导出图> -o public/assets/characters/heroine_idle.png --work art/work/<job>/edit-<日期> \
  --match public/assets/characters/heroine.png --video <原视频> --framing-from art/work/<job>/<自动交付的 work>/sheet.json \
  --source-url <导出图的 /uploads 地址> --pack public/assets/asset-pack.json --key heroine_idle --section characters \
  --spec art/spec.json --job art/jobs/<job>.jsonl
```

- **导出记录**：先读 PNG 里键名为 `ai-draw` 的 iTXt 块，里面有网格、帧数、每帧在原视频里的时间。帧率按相邻帧的时间间隔算，也就是真实速度。
- **旧导出没有记录时**：
  1. 用 `--video` 的帧尺寸和透明分布找网格；
  2. 和原视频逐帧比对，推算帧率；
  3. 还不行就用 `--grid 列x行`、`--fps` 指定。
- **用户的帧原样保留**：
  - 只做无损清理、对齐、打包、登记。
  - 重复帧也保留；`--drop-duplicates` 要等用户同意后再用。
  - 帧还带背景时，才用 `--cutout <算法>`。
- **`--framing-from`**：帧还在原视频坐标里（没裁切、没缩放）时，沿用自动交付的裁切框和比例，和立绘严丝合缝；否则按 `--match` 对齐。
- **`warnings`**：输出里的警告要在对话里告诉用户，并给出选项。警告包括：
  - 重复帧；
  - 循环接缝跳变；
  - 编辑器预览速度和抽帧帧率不同；
  - 帧率是推算的。

  可以给的选项，例如“按你选的范围从原视频重新抠一遍”“补齐结尾，让循环接上”。
- **帧率**：把项目里的帧率配置改成输出的 `fps`。

## 5. 接入游戏

- **缩放和原点**：按静态立绘算缩放（`displayHeight / 立绘高度`），原点放在脚底（0.5, 1）。这样即使待机帧因为头顶留白比立绘高，切换贴图时人物也不会跳。
- **Phaser**：
  - 写代码前读 `node_modules/phaser/skills/animations/SKILL.md`。
  - 创建动画：`scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(sheetKey), frameRate, repeat: -1 })`。
  - 帧数由 asset pack 的 `endFrame` 决定；站着时 `sprite.play(key, true)`，走动时 `anims.stop()` 并换回静态贴图。
  - 每种新动作只需要写一次代码；以后重做同一个动作，只要重新跑上面的命令。
- **纹理大小**：单边不超过 4096 px，排版时已经遵守。
- **单独调某一步**：
  - 抠图：`aidraw rmbg <帧…> --variant <算法> --out <目录>`；
  - 其余步骤：`sprite_tools.py` 里的 `extract`、`crop-frames`、`loop-scan`、`pack-sheet`、`anim-preview`。

## 6. 确认与交付

- **登记**：命令已经登记了 asset pack（带 `endFrame`）、规格（kind=animation、帧数、帧率、帧尺寸、来源、抠图算法；人工编辑的另有 `source.edited_by_user`）和任务日志。可以用 `asset_pack.py check` 检查。
- **会话**：只发精灵图动画和说明，游戏截图、检查结果在对话里报告。
- **提醒用户**：去项目预览里实际看，静态截图看不出动作。调速度只要改项目里的帧率配置，不用重新出图。
