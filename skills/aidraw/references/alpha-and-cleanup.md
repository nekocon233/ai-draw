# 透明背景与清理

## 先让背景好抠

- 提示词里要纯色背景：`纯白色背景`（主体很浅时改用 `纯中灰色背景` 或 `纯绿色背景`），并写 `无阴影，无地面，无渐变`。
- 不要指望 Qwen 的原生透明：实测输出基本不透明。第一次做项目时可以试一次加 `RGBA 透明背景` 的提示词，再用 `sprite_tools.py info` 看 `transparent_ratio`；有效就记进 `art/style.md`，无效就固定走抠图。
- 参考图上传前会被铺成纯色底（ComfyUI 不读 alpha），所以透明参考图的轮廓外会变成白色，这是正常的。

## 抠图怎么选

| 情况 | 方法 |
|---|---|
| 背景是干净的纯色 | `sprite_tools.py key`：从边缘向内填充，只去掉和边框相连的背景色，主体内部同色区域不受影响。快、边缘准 |
| 背景不干净，或头发等半透明细节多 | `aidraw rmbg <文件> --mode birefnet --model joelseytre/toonout`（ToonOut 适合动漫）。对比可以再试 `--mode inspyrenet` |
| 主体颜色和背景接近 | 换背景色重新生成，比硬抠可靠 |

后端抠图跑在 CPU 上，一张大图要几十秒。

## 清理顺序

```bash
S=<技能目录>/scripts/sprite_tools.py
python3 $S key raw.png -o keyed.png                     # 或者用 aidraw rmbg 的结果
python3 $S clean-alpha keyed.png -o clean.png           # 去掉几乎透明的像素和细小杂点
python3 $S defringe clean.png -o defringed.png          # 用内部颜色替换边缘颜色，去掉白边
python3 $S fit defringed.png -o final.png --height 340  # 预乘 alpha 缩放，不会产生光晕
python3 $S checker final.png -o final_check.png --dark  # 浅色棋盘格和深色底各看一遍
```

检查要点：

- `info` 的 `corner_alpha` 四个角都应为 0，`alpha_bbox` 不应贴住画布边缘（角色脚底除外）。
- 深色底上看边缘有没有白边，浅色底上看有没有黑边。
- 头发、裙摆的缝隙里有没有残留背景块（`key` 不处理被主体围住的背景，必要时加大 `--tolerance`，或改用 rmbg）。

## 游戏里的样子

游戏用 MULTIPLY 光照图把画面整体压暗，只有光斑里接近原色。交付前用 `mock` 做一张近似预览，和成品一起发回会话：

```bash
python3 $S mock final.png -o mock.png --bg <场景背景或墙面贴图> --height 230 --x 640 --y 578 --both \
  --ambient '#2c313b' --light 640,360,300,0.6
```

`--both` 会左右并排输出：左边不打光，右边打光。环境光颜色、光源位置和强度按项目里的光照参数填写。
