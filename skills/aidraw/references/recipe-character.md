# 配方：角色立绘（站姿）

目标：一张透明背景的全身立绘，按项目规格的朝向和尺寸交付，作为游戏贴图，也作为以后画姿势、做动作的基准图。

## 输入

- 角色原型图（例如 `prototype_art/character_prototype.png`），和 `art/style.md` 里定下的 LoRA 及风格描述。
- 规格：朝向（横版游戏一般朝右）、贴图高度、锚点（通常是脚底中点 `(0.5, 1)`）、是否透明、是否画投影（通常不画，代码会画）。

## 步骤

1. **候选**（Qwen 参考图生图）：参考图 1 用原型图。尺寸按目标比例取，并约为交付高度的 3–4 倍，例如交付 340 高时用 `768x1280` 或 `832x1280`。

   ```bash
   aidraw gen --session S --ref prototype_art/character_prototype.png --lora <style.md 里的 LoRA> \
     --size 768x1280 --count 4 --out art/work/heroine/candidates --job art/jobs/heroine.jsonl --step side-view \
     --prompt "<image1> 中的同一个角色，正侧面朝右站立的全身像，从头顶到鞋底完整可见，双脚着地，自然站姿，双手自然下垂。
   保持发型、发色、五官、服装款式和配色与 <image1> 一致。纯白色背景，无阴影，无地面，平光，无文字，无水印。<style.md 的风格描述>"
   ```

   如果 Qwen 改不动视角，可以先用 `--workflow gpt` 把原型转成侧面，再把 GPT 的结果作为参考图 1，回到 Qwen 加 LoRA 统一画风。
2. **自查**：`sprite_tools.py contact art/work/heroine/candidates/*.png -o art/work/heroine/contact.png`，自己看过之后剔除下列废片：朝向错、缺手缺脚、比例怪、服装和原型不一致、有文字、背景不干净。
3. **关卡（选 1）**：问题写清楚“朝右、全身、和原型一致”，告诉用户可以在同一会话里自己改提示词重画。
4. **细化**（可选）：在选中的图上，用同种子小改提示词；或者把它作为参考图 1 做编辑（修手、修脸、统一线宽）。
5. **后处理**（见 alpha-and-cleanup.md）：`key` 或 `rmbg` → `clean-alpha` → `defringe` → `fit --height <规格高度> --side-pad 2`。
   - 脚底必须贴底边。如果头发向后飘，导致身体偏离中线，用 `fit --offset-x` 把身体中线调到画布中心。
   - 朝向不对时，先水平翻转再交付（翻转后检查衣服上的文字或徽章）。
6. **确认关卡（`--max 0`）**：`aidraw post` 发回四张图：成品、浅色棋盘格预览、深色底预览、`mock` 游戏光照预览。
7. **交付**：见 phaser-delivery.md。

## 检查清单

- [ ] 尺寸与规格完全一致；脚踩底边；左右居中。
- [ ] 朝向正确；没有投影和地面。
- [ ] 透明边缘干净，在深色底上没有白边。
- [ ] 缩到游戏显示尺寸后，脸和关键特征（发色、服装主色）仍可辨认。
- [ ] 与原型一致：发型、配色、服装款式。
- [ ] 侧视基准图另存一份（`art/work/<job>/base.png`，或作为 `final` 的来源），以后画姿势、做动作都从它出发。
