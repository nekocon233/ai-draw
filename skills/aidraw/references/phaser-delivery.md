# 交付到 Phaser 项目

交付是项目自己的一轮工作，按项目的 `AGENTS.md` 流程走（例如 classroom：说明改动范围、`npm run check` 必须输出 `check: OK` 并亲自看截图、按格式给出验收清单、用户说“通过”才提交）。

## 步骤

1. **对照规格**：`asset_pack.py check --spec art/spec.json --root . --pack public/assets/asset-pack.json <key>` 应当全部通过（文件、尺寸、透明度、接缝、登记）。
2. **保持 key 不变**：覆盖原来的文件（同路径、同文件名），asset pack 不用改。新增贴图时用 `asset_pack.py register` 登记到合适的分组。
3. **尺寸变化时同步代码常量**：规格里的 `code_refs` 列出了和尺寸相关的常量，例如角色的 `displayHeight`、硬编码的缩放比例、眼睛等挂点的偏移、交互提示的高度。能保持原尺寸就保持，这样不用改代码。
4. **占位图脚本**：项目里生成占位图的脚本必须跳过状态不是 `placeholder` 的 key，否则重新运行会把成品覆盖掉。
5. **更新规格和日志**：`spec-set <key> status=generated source={...}`（写明 job、会话、消息、url、种子和文件的 sha256），再往任务日志追加一条 `deliver` 记录。用户在项目里验收通过后，再改成 `final`。
6. **自检**：运行项目的检查（classroom 是 `npm run check`，还有 `npm test`），亲自看截图；涉及朝向的改动要确认测试里关于朝向的断言仍然成立。
7. **验收**：在对话里给出项目要求的验收清单，附上 ai-draw 会话链接。`mock` 预览、游戏截图、检查结果只放在对话里（本地路径），不发进 ai-draw 会话；会话里只有成品素材的帖子和交付后关卡（见 SKILL.md 第 5、6 节）。
8. **用户编辑过的成品**：交付后关卡里选用了用户的编辑结果时，用同样的规格和 key 重新交付。动画用 `edit_to_sheet.py`，静态图走上面的步骤。规格写上 `source.edited_by_user`，再跑一遍 `asset_pack.py check` 和项目检查。

## Phaser 相关

- 写代码前读当前安装版本的 `node_modules/phaser/skills/loading-assets/SKILL.md` 和 `animations/SKILL.md`（Phaser 4）。
- 单张图片用 `image`；固定网格的帧动画用 `spritesheet`（`frameConfig.frameWidth/frameHeight`）；帧尺寸不一致时用 `atlas`。序列帧属于第二阶段。
- 光照：MULTIPLY 光照图会把颜色整体压暗，素材要按“全亮时的固有色”画；`emissive` 及以上的层不会被压暗。
- 不要编辑 Phaser Editor 生成的代码区和 `.scene` 文件；场景布置由用户在编辑器里完成。
