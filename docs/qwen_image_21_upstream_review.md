# Qwen-Image-2.1 上游工作流与训练问题复核

本次复核只查阅上游资料、核对本机实现与检查点；没有替换线上采样器、改动训练参数或开启新训练。

## AI Toolkit 访问和本次训练记录

- 容器 `ai-toolkit` 正在运行，宿主机发布端口为 `8675`。容器内访问 `http://127.0.0.1:8675` 返回 HTTP 200。
- 在服务器本机打开 `http://127.0.0.1:8675`，从其他机器访问 `http://服务器IP:8675`。当前 FRP 配置没有 AI Toolkit 的公网域名。
- 可在自己的电脑运行 `ssh -N -L 18675:127.0.0.1:8675 nekocon-server`，随后访问 `http://127.0.0.1:18675`；该命令使用已有的 SSH 别名。
- 如界面要求密码，使用部署配置中的 `AI_TOOLKIT_AUTH`，配置文件为 `/opt/ai-toolkit/.env`；本文不记录凭据。
- 本轮训练通过 AI Toolkit 命令行 `sd_trainer` 启动，没有写入 Web UI 的 Jobs 表。只读查询确认 `name = AmeniwaQwen21` 的 UI 任务数为 0。
- 最终实际配置：`/opt/ai-toolkit/output/AmeniwaQwen21/config.yaml`；项目配置：`configs/training/ameniwa_qwen_image_21.yaml`。
- 各阶段日志分别保留在容器 `ai-draw-qwen21-training`、`ai-draw-qwen21-training-3000`、`ai-draw-qwen21-training-until2230`、`ai-draw-qwen21-training-4000`，可使用 `docker logs 容器名` 查看。

## 官方来源及模板对应关系

- [Qwen 官方仓库](https://github.com/QwenLM/Qwen-Image-2.1)：明确链接以下两个 ComfyUI 模板，并给出文生图、图生图和多参考图的原生示例。
- [ComfyUI 文生图模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json)。
- [ComfyUI 图生图模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json)。
- [ComfyUI 原生支持 PR #16400](https://github.com/Comfy-Org/ComfyUI/pull/16400)。
- [Qwen 官方调度器配置](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/scheduler/scheduler_config.json)。
- [Diffusers 原生 Pipeline](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py)。

当前上游 ComfyUI 模板使用 INT8 ConvRot DiT、INT8 ConvRot Qwen3-VL、BF16 VAE、`TextEncodeQwenImage21`、Euler/simple、CFG 1、denoise 1；模板默认 25 步，Qwen 原生示例为 40 步。项目采用 40 步，并将子图、尺寸开关及输入控件转换为后端构图逻辑。上游图生图模板同样使用 `QwenImage21Cache` 和来自编码节点的参考尺寸 latent。

项目中的 LoRA 是额外的应用适配，现已显式加入静态模板并由后端按用户选择替换或移除。静态 JSON 并非官方原样文件。节点名称和连接相同，也不代表 ComfyUI 的数值实现与 Qwen 原生 Pipeline 完全等价。

## 已确认：采样调度存在差异

[ComfyUI issue #16447](https://github.com/Comfy-Org/ComfyUI/issues/16447) 报告固定 shift 与官方动态调度不一致，目前为 open，未见维护者确认或修复评论。

该实现差异已独立核对：

- 本机 `comfy/supported_models.py` 的 `QwenImage21.sampling_settings` 固定 `shift = 0.69`。
- `comfy/model_sampling.py` 的 `ModelSamplingFlux` 在加载时生成固定 sigma 表；`simple_scheduler` 从该表取样。
- 官方配置启用 `use_dynamic_shifting = true`，参数为 `base_image_seq_len=256`、`max_image_seq_len=8192`、`base_shift=0.5`、`max_shift=0.9`，并设置 `shift_terminal=0.02`。
- 官方 Pipeline 根据目标 latent 数量计算 mu，并从调度器配置读取上述参数。

按两边实现的公式对 40 步进行数值复算：

| 正方形输出尺寸 | 官方 mu | 本机 ComfyUI mu | sigma 序列最大绝对差 |
|---|---:|---:|---:|
| 512 | 0.538710 | 0.69 | 0.050617 |
| 768 | 0.603226 | 0.69 | 0.036850 |
| 1024 | 0.693548 | 0.69 | 0.028635 |
| 2048 | 1.312903 | 0.69 | 0.125440 |

两者最后一个非零 sigma 分别为约 0.048635（本机）和 0.02（官方）。这些数值证明调度不一致，不是图像质量分数。尤其大分辨率需要进一步做相同提示词、参考图、seed 的调度对照；目前不能将该差异直接认定为 LoRA 画风问题的根因。

## 参考图约束：VAE 参考潜变量与视觉编码条件

ComfyUI PR #16400 明确说明：有 VAE 时，参考图通过 VAE 潜变量插入 DiT 序列；没有 VAE 时，视觉隐藏状态被保留，图片只通过编码器提供条件。

本机 `comfy_extras/nodes_qwen.py` 的 `TextEncodeQwenImage21.execute` 与该说明一致：

- 接入 `vae` 时生成 `reference_latents` 并附加到 conditioning。
- 不接 `vae` 时保留视觉编码状态，不提供上述参考潜变量。
- 输出侧的 `VAEDecode` 仍然需要 VAE；要改变的是 **TextEncodeQwenImage21 的 vae 输入**。

后者可以作为较弱的参考方式，但会降低人物身份、构图和细节保真，不是一个线性的“参考图权重”百分比。本机尚未针对用户的具体参考图验证其效果。官方 Diffusers `QwenImage21Pipeline.__call__` 也没有提供通用的参考图 `strength` 参数。

项目的 `LocalComfyUIRequest.generate_qwen_image_21` 在有图片时固定将 VAE 接入编码节点，因此网页当前采用参考潜变量编辑路径。只从 JSON 中删除这条线会被后端重新添加；若要在网页选择较弱参考模式，需要把它作为显式选项贯穿验证、构图与界面。

[ComfyUI issue #16435](https://github.com/Comfy-Org/ComfyUI/issues/16435) 还报告了参考处理分辨率恰为 1024 时的噪点异常，并观察到断开编码节点的 VAE 后参考依从减弱。该报告目前同样为 open，报告环境和症状不能直接套用到本机，更不能据此把所有编辑问题归为同一原因。

## 训练问题报告与本机检查点核对

[AI Toolkit issue #1054](https://github.com/ostris/ai-toolkit/issues/1054) 报告 `qwen_image_2` 在梯度检查点和层卸载组合下，可能出现损失有限但 LoRA 上投影为零、或权重后续不再更新的问题。报告使用 Windows、Torch 2.7.0 和指定的 main 提交；报告中的临时 workaround 也未被证明有效。

对本机保存的实际张量做只读比对：

| 检查点步数 | 非零上投影 | 全部张量有限 | 相较上一检查点有变化的张量 |
|---|---:|---|---:|
| 1200 | 192 / 192 | 是 | — |
| 3000 | 192 / 192 | 是 | 384 / 384 |
| 3942 | 192 / 192 | 是 | 384 / 384 |
| 4000 | 192 / 192 | 是 | 384 / 384 |

因此本轮检查点不符合报告中的“全零／只改 metadata、权重不再变化”的表现。这只能排除该具体症状，不能证明当前数据、标注或训练参数已经足以满足画风泛化目标。

## 后续验证重点

1. 用同一参考图和 seed 对比当前参考潜变量编辑路径与仅视觉编码条件路径，评价保真与风格之间的变化。
2. 将采样调度对齐官方动态 mu 和 terminal stretch 后做独立 A/B，避免同时修改训练权重或提示词而无法归因。
3. 训练端继续检查标注与目标提示词分布、各检查点在固定验证组中的风格表现；不能仅依据训练步数或 loss 认定训练达标。

## 2026-09-22：双语 4000 步后，普通短句仍偏写实的调查

本节针对 UI 任务 `AmeniwaQwen21Bilingual`，与上文早期命令行任务区分。用户的验收目标是选择该风格 LoRA 后，仅输入 `一个女孩` 就呈现 Ameniwa 的粗线、平涂二次元画风；要求用户追加 `二次元` 只能作为当前权重的临时用法，不能视为达到这个训练目标。本次只查阅资料并做 CPU 上的权重／缓存核验，没有更换线上模型或启动新训练。

### 来源与适用范围

1. [Diffusers：加载 LoRA 与调整强度](https://huggingface.co/docs/diffusers/main/en/using-diffusers/loading_adapters#lora)。LoRA 修改模型权重，文档同时提供普通内容提示词和带触发词的示例；是否依赖触发词取决于训练方式，并非 LoRA 加载机制要求必须出现风格词。文档说明 scale 0 为基模、scale 1 为完整适配强度；这不保证任意训练结果都能覆盖基模的所有语义与画风倾向。
2. [Qwen-Image-2.1 官方 prompt rewriting 建议](https://github.com/QwenLM/Qwen-Image-2.1#prompt-rewriting)。官方推荐把短提示词扩写为详细描述以改善基模表现；这是生成建议，不是“风格 LoRA 必须输入二次元”的要求，也没有给出本例的确定根因。
3. [AI Toolkit 0.13.18 数据加载实现](https://github.com/ostris/ai-toolkit/blob/31ddc709c35d3d3b820c636745397561f806b246/toolkit/dataloader_mixins.py#L336) 与 [Qwen 2.1 编码实现](https://github.com/ostris/ai-toolkit/blob/31ddc709c35d3d3b820c636745397561f806b246/extensions_built_in/diffusion_models/qwen_image_2/src/pipeline.py#L119)。读取完整 txt，按整体 caption 缓存；caption dropout 使用空文本缓存，不会自动切成中文、英文或短句。编码器没有启用文本截断。
4. [AI Toolkit issue #1054](https://github.com/ostris/ai-toolkit/issues/1054) 报告 Qwen 2.1 在特定环境中出现零梯度／权重停学，仍为未确认适用于本机的用户报告；本机下面的阶段比对不符合其特征。
5. [Qwen 官方仓库 issue #3](https://github.com/QwenLM/Qwen-Image-2.1/issues/3) 是 DiffSynth 的 `validate_full` 未加载全量训练产物，报告明确区分了正确加载的 `validate_lora`。本项目使用 AI Toolkit LoRA 与其原生预览，不是该验证脚本。
6. [Replicate 的 Qwen-Image LoRA 训练器说明](https://github.com/replicate/qwen-image-lora-trainer#important-qwen-prompting) 强调 Qwen 对描述语义敏感，并建议使用与图像内容匹配的熟悉词语。该经验来自早期 Qwen-Image，不能当作 Qwen-Image-2.1 的官方训练配方或本例根因证明。

### 本机新证据

- AI Toolkit 提交为 `31ddc709c35d3d3b820c636745397561f806b246`。比对双语新任务的 200→2000→3800→4000 步权重，每一段均有 **384/384 个张量变化**，所有张量有限；最终 192 个上投影均非零。不能将本例归为 issue #1054 描述的全零或停学。
- 26 份训练 caption 全部为英文标签加中文长描述；14 份以 `1girl` 开头，没有独立中文开头或不足 30 字符的短 caption。没有自动按语言拆分的训练设置。
- 用本次训练实际的 Qwen processor、chat template 和 system token 去除规则，逐一核对 26 张图缓存：完整双语 caption 对应的序列长度为 **212–333**，26/26 与 `_t_e_cache` 实际张量长度一致，中文可完整编码／解码。未发现中文未读入或被尾部截断。
- `caption_dropout_rate=0.05` 表示随机使用空提示条件，不等于训练 `一个女孩`、`一个男孩` 等简短内容描述；文本编码器冻结且开启特征缓存，实际是重复学习同一份完整双语条件及空条件。
- 原生 AI Toolkit 在固定 seed 42、1024×1024、CFG 1、40 步、LoRA 0.8 下，0 步与最终 4000 步的 `一个女孩` 均为照片；`一个二次元女孩` 和英文动漫标签则出现从细腻渐变到粗线平涂的变化。这是首尾检查点的对照，不代表所有中间阶段都写实：后续确认 **3200 步的同一句短提示词已呈粗线平涂**，见下文阶段复核。该现象在 AI Toolkit 内部已存在，因此不能用 ComfyUI 静态 JSON 没有 LoRA 节点解释。
- AI Toolkit UI 的 Qwen 2.1 预览默认 CFG 为 3，但同版本原生 pipeline 注释说明该模型按无 CFG 引导采样设计、默认 CFG 1。当前 CFG 1 有源码依据；仅凭 UI 默认值不同不能认定当前工作流错误。

### 原因排序与下一步对照

阶段复核发现 3200 步的 `一个女孩` 预览为粗线平涂，而 3600、4000 步又为照片。下一步优先验证**现有检查点的选择与跨 seed 稳定性**，不能先假定最终 4000 步最好，也不能依据这一条轨迹就确诊过拟合。具体最小对照见下文。

**训练条件与实际使用条件不同，画风对普通短提示词的泛化不足**仍是候选解释：在同一个 txt 后面加中文，不等于分别用中文、英文和简短提示训练。但 3200 步的成功说明不能把普通中文短句描述成必然失效；尚未做单变量训练对照，不能称标注方式为已锁定的唯一根因。26 张训练图的内容覆盖、LoRA 容量和训练参数也是候选因素，目前没有证据把问题单独归给 Prodigy、rank 16、ConvRot8 或总步数。

用户已反馈尝试 **0、0.8、1** 三种强度，“都是一样”。保留该反馈，不再重复要求相同的强度对照。尚未核对这组测试对应的权重版本、seed，以及“一样”指画风相同还是像素相同，因此不将其表述为已证明新版权重在所有强度下完全无效。

若已有检查点在多个 seed 和普通中文提示词下仍不稳定，再考虑小规模、单变量 caption 试验：保留原始双语标注文件，训练时按明确比例使用独立中文短句、中文详细描述和英文描述，并分别缓存各变体；其它已确认参数与固定验证组不变。短句必须与实际图像内容一致，验证继续只用原始短句，不追加画风词。先观察 600–1000 步是否改善多个 seed 下的画风，再决定是否跑完整 4000 步；不同时更换优化器、rank、分辨率和采样器。此训练试验尚未执行。

### 后续雨衣提示词对照：先核对实际版本和强度

用户随后报告 Toolkit 的中文雨衣预览为二次元，而网页相同提示词为照片。已查到最近三次该提示词的应用记录与 ComfyUI 执行图均使用 **旧版 `AmeniwaQwen21.safetensors`、实际强度 0.0**，而 Toolkit 使用本轮双语新版 0.8；seed 也不同。因此这组对照不能作为“双语新版在 ComfyUI 无效”或“中文条件泛化失败”的证据；此前短句 `一个女孩` 的结果仍是另一项独立观察。

已将双语新版以独立名称安装并登记，保留旧版。通过生产 provider 使用雨衣原句、新版 0.8、seed 42、1024×1024、40 步、CFG 1 实测，ComfyUI 也生成了粗线平涂二次元画风，主要构图与 Toolkit 预览接近。图片和完整执行记录见 [`qwen_image_21.md`](qwen_image_21.md#雨衣提示词的版本强度差异与新版上线)。这证明当前网页生成链路可应用新版画风，不能据此扩展为所有短提示词、所有 seed 都已达标。

## 2026-09-22：已有阶段预览复核，3200 步出现短句风格成功样本

本轮继续检查既有预览，未启动新训练或推理，也未安装、替换线上权重。实际 `.job_config.json` 确认后缀 `_0` 对应原文 `一个女孩`，不含画风词；参数统一为 seed 42、`walk_seed=false`、1024×1024、40 步、CFG 1、LoRA 0.8、空负面提示词。预览目录为 `/opt/ai-toolkit/output/AmeniwaQwen21Bilingual/samples/`。

用户收到的最后六张工具图片与原文件逐一计算 SHA-256 匹配，全部对应 `_0`，顺序并非训练步数顺序：

| 图片顺序 | 训练步数 | 原预览文件 | 视觉观察 |
|---|---:|---|---|
| 1 | 2800 | `1790030181004__000002800_0.jpg` | 戴帽女孩，写实照片 |
| 2 | 2000 | `1790028335839__000002000_0.jpg` | 花裙女孩，写实照片 |
| 3 | 1600 | `1790027400111__000001600_0.jpg` | 花裙女孩，写实照片 |
| 4 | 2400 | `1790029258013__000002400_0.jpg` | 花裙女孩，写实照片 |
| 5 | **3200** | `1790031103577__000003200_0.jpg` | **红上衣、格裙、挎包人物，明显粗黑轮廓和块面阴影的二次元插画** |
| 6 | 3600 | `1790032031036__000003600_0.jpg` | 红上衣、格裤、蹲姿女孩，写实照片 |

3200 步图片 SHA-256：`addf240e9a1f8c4a088a82bd70565550ad1e231a263b919c50426faf592341e2`。其对应的已保存权重为 `/opt/ai-toolkit/output/AmeniwaQwen21Bilingual/AmeniwaQwen21Bilingual_000003200.safetensors`；本轮只确认文件存在，未重新核验该权重的张量或加载推理。

此前 0、400、800、1200 及 4000 步 `_0` 预览均观察为照片；结合本组六张，已检查的 11 个预览阶段中，3200 步出现了明确的目标风格样本。这是同一条提示词和同一个 seed 的阶段比较，不能将“一张成功”当作随机生成的成功率。此前“各阶段均写实／没有更早检查点值得验证”的会话判断需要撤回；3200 步现在是优先候选。另一方面，尚无跨 seed、跨普通提示词的证据，不能宣称它整体优于 4000 步或已经满足用户目标。

动漫语义对照沿用已完成的核对：`一个二次元女孩`（`_1`）和英文标签（`_2`）的 0 步基线为细线、柔和渐变动漫图，4000 步结果出现明显粗线和平涂变化。它们证明风格确实被学到，不代替普通中文短句验收。

最小后续验证方案（尚未执行）：

1. 保留线上两个 4000 步版本，用独立临时名称验证 3200 步权重；记录权重哈希、实际加载节点、强度与 seed，不覆盖现有文件或历史配置。
2. 先在同一生产推理链路对比 3200／4000 步，提示词固定为 `一个女孩`，seed 固定为 42、43、44，LoRA 0.8、1024×1024、40 步、CFG 1、无参考图，其余设置相同，共 6 张。先判断 3200 步 seed 42 的已有风格能否复现，再比较其它 seed；保留失败样本，不只展示成功图。
3. 若候选确有改善，再用普通中文内容描述及已有雨衣句检查内容遵循与风格，必要时补看 3000／3400 步，之后再决定是否作为独立网页选项。只有现有检查点验证仍不理想时，才进入前述单变量标注训练试验。
