# 透明背景与清理

## 先让背景好抠

- 提示词里要纯色背景：`纯白色背景`（主体很浅时改用 `纯中灰色背景` 或 `纯绿色背景`），并写 `无阴影，无地面，无渐变`。
- 不要指望 Qwen 的原生透明：实测输出基本不透明。第一次做项目时可以试一次加 `RGBA 透明背景` 的提示词，再用 `sprite_tools.py info` 看 `transparent_ratio`；有效就记进 `art/style.md`，无效就固定走抠图。
- 参考图上传前会被铺成纯色底（ComfyUI 不读 alpha），所以透明参考图的轮廓外会变成白色，这是正常的。

## 抠图：只用背景处理算法

一律用 ai-draw 后端的背景处理算法（`aidraw rmbg`）。不要用换色或颜色键，包括后端的 edge 模式：它们只能去掉和边框相连的背景，手臂和身体之间、两腿之间这类被主体围住的空隙会残留背景色。

### 先让全部算法各抠一次

```bash
python3 <技能目录>/scripts/cutout_compare.py picked.png --work art/work/<job>/cutout --job art/jobs/<job>.jsonl
```

- 生成两张对比图：品红底的 `compare.png` 和深色底的 `compare_dark.png`。图上的编号和算法名与网页一致。
- 清理后的结果在 `clean/<算法>.png`，已经做过 clean-alpha 和 defringe，可以直接接着做 rectify 或 fit。

### 自己挑

看对比图挑；看不清的地方，裁出可疑区域放大再看。标准：

1. 被围住的空隙是品红色，不是白色。重点看手臂和身体之间、两腿之间、头发和脸之间。
2. 主体没有缺块：品红没有透进衣服、皮肤或白色部件。
3. 边缘没有白边或灰边，头发和裙摆的细节保留得越多越好。
4. 图上标着两个数，用来辅助判断：
   - `bg`：不透明像素里仍是背景色的比例。比其他算法明显高，多半残留了背景。主体自己的白色部分对每种算法都一样，不影响比较。
   - `opaque`：不透明像素的比例。明显偏低，多半抠掉了主体。

### 选定之后

- 把对比图发回会话，写明选了几号、为什么。用户不同意，就换成他说的那一号。
- 把选择记进规格的来源（`cutout`）。
- 把这一类素材（角色、道具、图标）用的算法记进 `art/style.md`，下次同类素材可以直接用。成品检查发现问题时再重新对比。
- 用户想自己挑时：把 `clean/` 里的结果用 `aidraw post` 发进会话，再开 `--max 1` 的关卡。

### 算法对照

| 编号 | `--variant` | 网页里的选项 |
|---|---|---|
| 1 | `inspyrenet-base` | InSPyReNet · base |
| 2 | `inspyrenet-fast` | InSPyReNet · fast |
| 3 | `inspyrenet-base-nightly` | InSPyReNet · base-nightly |
| 4 | `birefnet` | BiRefNet · BiRefNet |
| 5 | `birefnet-toonout` | BiRefNet · ToonOut |
| 6 | `birefnet-hr-matting` | BiRefNet · HR-matting |
| 7 | `birefnet-dynamic` | BiRefNet · dynamic |
| 8 | `birefnet-matting` | BiRefNet · matting |
| 9 | `rembg-isnet-anime` | rembg · isnet-anime |
| 10 | `rembg-isnet-general-use` | rembg · isnet-general-use |
| 11 | `rembg-u2net` | rembg · u2net |
| 12 | `rembg-u2netp` | rembg · u2netp |
| 13 | `rembg-u2net-human-seg` | rembg · u2net_human_seg |

后端抠图跑在 CPU 上，每张几秒到几十秒；rembg 开着 alpha matting，会更慢。某个模型第一次用时要先下载（BiRefNet 系列每个约 1 GB），之后常驻后端内存。

## 清理顺序

`cutout_compare.py` 的 `clean/` 结果已经做过前两步清理。单独处理时按这个顺序：

```bash
S=<技能目录>/scripts/sprite_tools.py
aidraw rmbg raw.png --variant <选定的算法> --out cut/      # 背景处理算法，结果是 cut/raw.png
python3 $S clean-alpha cut/raw.png -o clean.png            # 去掉几乎透明的像素和细小杂点
python3 $S defringe clean.png -o defringed.png             # 用内部颜色替换边缘颜色，去掉白边
python3 $S rectify defringed.png -o rectified.png          # 只对带透视的平面物体：按外轮廓四角拉正
python3 $S fit defringed.png -o final.png --height 340     # 预乘 alpha 缩放，不会产生光晕
python3 $S checker final.png -o final_check.png --dark     # 浅色棋盘格和深色底各看一遍
```

检查要点：

- `info` 的 `corner_alpha` 四个角都应为 0；`alpha_bbox` 不应贴住画布边缘（角色脚底除外）。
- 深色底上看边缘有没有白边，浅色底上看有没有黑边。
- 头发、裙摆的缝隙里，以及手臂和身体之间，有没有残留的背景块。有就换一种算法。

## 游戏里的样子

游戏用 MULTIPLY 光照图把画面整体压暗，只有光斑里接近原色。交付前用 `mock` 做一张近似预览，和成品一起发回会话：

```bash
python3 $S mock final.png -o mock.png --bg <场景背景或墙面贴图> --height 230 --x 640 --y 578 --both \
  --ambient '#2c313b' --light 640,360,300,0.6
```

`--both` 会左右并排输出：左边不打光，右边打光。环境光颜色、光源位置和强度按项目里的光照参数填写。
