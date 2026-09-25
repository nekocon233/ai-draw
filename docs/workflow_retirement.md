# 2026-09-22 工作流清理

Q-Image（旧 Qwen-Image-Edit）及 Ideogram 已退役。生图方式现为 Z-Image、Qwen-Image-2.1、GPT Image；Qwen 2.1 仍按参考图在文字／编辑模式间切换，Ameniwa 继续使用双语 4000 步权重。

## 应用改动

- 删除 `i2i`、`ideogram_t2i`、`ideogram_style` 的登记、工作流 JSON、专用 ComfyUI 适配、提示词转换、训练／安装／验收脚本及配置。删除 `IDEOGRAM_*` 设置并同步 `.env.example` 和本机 `.env`。
- 删除风格参考图的生成、事件、成品重试、前端类型和界面。保留通用生成生命周期、结果保存、参考图所有权检查及媒体清理能力。
- 旧会话的工作流回退到当前默认方式，清空退役工作流的 LoRA 选择。工作流元数据先到或后到均处理；历史记录本身不改写，退役记录的直接重新生成会提示选择可用方式创建新任务。
- 选择“不使用 LoRA”或点击 × 后隐藏强度文字和滑条，选择框占满整行；选择模型后恢复滑条，× 仍在末尾，数值只显示在滑条提示内。保存、刷新、取消均保留预期选择。

## 历史图片迁移

`server/legacy_media.py` 在启动事务内检查旧 `generation_style_references` 表，将每张图追加到原用户、原会话的助手回复中。已有成品的索引与路径保持不变；没有回复时建立对应回复，已有相同路径时不重复添加。所有权或轮次不一致时回滚，完成后才移除旧表。迁移可重复执行。

部署前数据库备份为 `/tmp/opencode/ai-draw-before-workflow-retirement-20260922.dump`，已通过 `pg_restore --list` 验证。部署后核对原有 **145** 条图片记录的摘要不变，**1** 张旧风格参考图已归入普通历史图片，文件 SHA-256 不变，旧表已移除。该迁移没有删除上传文件或生成结果。

## 专用资源清理

从 `/opt/comfyui/storage-models/models/` 删除以下 14 个文件（合计 121,101,027,826 字节）：

- 旧 Qwen-Image-Edit 2509 FP8、2511 BF16 模型。
- Ideogram 4 的 FP8／NVFP4 主模型与 unconditional 模型，共 4 个。
- 旧 Qwen 2.5 VL 7B FP8 编码器、Ideogram 使用的 Qwen3-VL 8B FP8／NVFP4 编码器。
- 旧 Qwen Image VAE、Flux2 VAE。
- Qwen-Image-Edit 2509／2511 Lightning 与旧 Qwen-Image Lightning，共 3 个加速 LoRA。

同时删除对应的 14 个下载元数据／锁文件，以及 ComfyUI 用户工作流目录中的 `qwen_image_edit_workflow_api.json`、`img_pose.json`、`lora_image.json`。另通过 Hugging Face 缓存管理 API 删除 `ideogram-ai/ideogram-4-fp8` 的唯一缓存版本，清理 9,469,499,269 字节。模型与缓存合计约 **130.6 GB**；详细文件清单与迁移前摘要保存在 `/tmp/opencode/ai-draw-workflow-retirement-20260922.json`。

核对保留的工作流无上述文件依赖。Qwen 2.1 的 ConvRot8 主模型／编码器／专用 VAE、两个 Z-Image Ameniwa LoRA 均在，双语 Ameniwa 的 SHA-256 仍为 `3f07795cb2f9f96515c89a0e7520eb27e8d47f1374caae72b2dd32bc24b65ec4`。原始训练集、现有 Qwen 2.1 训练产物和其它生成／处理模型保留。

## 验证与部署

- 后端 105 项测试、前端 62 项测试、修改文件定向 lint、前端生产构建通过。
- 执行完整 `deploy: remote` 等价流程，仅刷新 `frontend-dist`，后端与 PostgreSQL 健康。
- 真实认证 API 中，退役工作流的 LoRA 列表返回 404，生成请求返回 422；Qwen 2.1 两种模式的列表仍仅返回双语 Ameniwa。
- 本地和部署后的浏览器检查覆盖桌面 1440px、手机 390px／320px、Qwen 编辑模式，以及三个退役工作流的历史会话：关闭 LoRA 后控件隐藏并能保存／刷新恢复、模型列表只展示当前三种方式、旧 LoRA 不泄漏到回退方式、旧记录不会提交退役生成请求。浏览器写入使用隔离的接口模拟；真实 API 检查的临时用户已清理。

## 2026-09-24：Z-Image 退出应用，资源保留

- 删除 `t2i` 的工作流登记、LoRA 列表、提示词模板、应用工作流 JSON、`comfyui_t2i` provider，以及 service／request 接口／HTTP 实现中的 `generate_t2i` 调用链。生图入口只保留 Qwen-Image-2.1 与 GPT Image。
- 默认方式统一为 `qwen_image_21_t2i`。用户注册、缺省配置、配置重置、新会话均读取配置中的默认工作流；请求模型与前端兜底同步。默认配置不再访问写死的 `workflow_metadata.t2i`。
- 旧会话沿用通用退役工作流回退：选择可用方式、清空旧 LoRA、按新方式限制生成数量。历史消息和图片不迁移、不删除；退役记录的“编辑并重新生成”入口禁用，后端拒绝旧工作流的生成和 LoRA 列表请求。通用历史字段继续保留。
- 用户配置的提示词和强度允许为空，前端加载时使用界面默认值，避免缺省配置读取失败。
- 保留 `/opt/comfyui/storage-models/models/` 下的 `z_image_turbo_bf16.safetensors`、`qwen_3_4b.safetensors`、`ae.safetensors`、`AmeniwaZ.safetensors`、`AmeniwaZ_30000.safetensors`；保留 AI Toolkit 的原始数据、训练配置快照、检查点、预览和备份。独立 ComfyUI 环境及其资源不清理。
- 不修改数据库结构，不执行历史数据迁移；部署仍只刷新 `frontend-dist`，保留 PostgreSQL、上传文件和 Hugging Face 缓存卷。
- 验证完成：124 项后端测试、77 项前端测试、修改文件的定向 lint、前端生产构建和 Docker 构建通过。全量前端 lint 有 24 个既有错误，位于本次未修改的 `utils/helpers.ts` 与 `utils/indexedDB.ts`，未顺带修复。
- 本地构建与部署后的浏览器检查均覆盖 1440px、390px 旧 Z-Image 会话，以及已有 Qwen 编辑会话：生图方式只有 Qwen／GPT Image，旧历史图片仍展示，旧记录重生按钮禁用，回退不带旧 LoRA，数量从 8 限制为 4；Qwen 编辑的参考图和 Ameniwa 0.75 选择保持有效。浏览器会话和写入接口使用隔离模拟，不执行真实推理。
- 部署前 ComfyUI 队列为空，认证服务停止接口确认无活动生成任务后执行完整 `deploy: remote` 等价流程。部署后真实认证 API 验证新用户／新会话默认 Qwen、配置重置可读、旧 LoRA 接口 404、旧生成和切换接口 422；验证账号及会话已清理，后端与 PostgreSQL 健康，绘图服务可用。
- 部署前后核对：上述 5 个模型／LoRA 文件的 SHA-256 全部一致；25 条旧 `t2i` 消息与其 38 条图片记录的数量及完整记录摘要一致。

## 2026-09-24：Wan 退出应用并清理专用资源

- 移除 `flf2v`、`i2v` 的元数据、应用工作流 JSON、provider 与 ComfyUI service／request 实现。删除循环开关、往返双提示词、帧数／帧率设置及 Wan 专用的首尾帧分析面板和 `/api/prompt/analyze-frames`；MiniMax H3 的可选首尾帧上传、互换、视频预设及动作参考分析保留。
- 当前可选执行工作流为 Qwen-Image-2.1 文字／编辑、GPT Image、MiniMax H3 首尾帧与动作参考，共 5 个。旧 Wan 会话沿用通用回退，清空旧 LoRA，历史结果和提示词仍可查看；退役记录不能直接重新生成。
- 不删除或改写历史消息、生成媒体与数据库旧列。旧尾帧描述、循环与帧数配置仅保留为历史数据，当前前端不再恢复它们，生成请求不再接受或传递这些参数。
- 已从 ComfyUI 模型目录删除 19 个 Wan 专用权重：12 个主模型（含 DaSiWa、Wan 2.1／2.2、Fun Inpaint、Animate）、5 个 LoRA（含 LightX2V）、Wan VAE 和 UMT5 文本编码器。另删除 ComfyUI 用户目录中的 4 份 Wan 工作流。磁盘分配空间合计约 **176.29 GiB（189.29 GB）**，逐文件清单见 `/tmp/opencode/wan-retirement-resources.json`。
- 已确认 Qwen、MiniMax H3 及放大工作流没有上述依赖。保留历史视频、上传文件、其它模型与 LoRA、训练文件、共享 ComfyUI 节点包及上游核心代码；`lika.safetensors` 经模型头确认属于 SDXL，因此保留。
- 本地回归通过：前端 90 项测试、后端 150 项测试、前端生产构建和 Docker 构建；浏览器覆盖 1440／390／320 宽度的 H3 默认预设、空描述提交、取消恢复、无 Wan 入口、旧会话回退和历史描述只读展示。全量 lint 的 24 个既有问题仍在，未新增。
- 等待已有 MiniMax H3 动作参考任务结束，确认 ComfyUI 队列及应用任务均空闲后，执行完整 `deploy: remote` 等价流程，只刷新 `frontend-dist`。线上服务正常，真实认证 API 拒绝 Wan 生成／切换请求（422）及 LoRA 请求（404），已移除的分析接口返回 404；保留的 Qwen／H3 模型依赖均可用。临时验证账号已删除。
- 部署前后 74 条 Wan 历史消息、37 条媒体记录的完整摘要一致，快照保存在 `/tmp/opencode/wan-retirement-history.json`。线上静态资源的 1440／390／320 浏览器检查通过；业务写入采用隔离模拟，没有提交实际推理。动作提示词直接填入、刷新后的缓存复用、失败保留输入和过期响应丢弃也通过回归。
