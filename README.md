# ai-draw

> 面向 AI 图像、视频生成与素材处理的浏览器工作台。

![ai-draw 界面预览](frontend/public/example.png)

ai-draw 采用 FastAPI + React 前后端分离架构，可将生成任务分发到 ComfyUI、Gemini/Nano Banana、OpenAI 兼容图像 API 和 Kling API。生成结果、聊天会话与用户配置持久化到 PostgreSQL，任务状态和结果通过 WebSocket 推送到前端。

## 主要功能

- 文生图、单图/多参考图编辑和图生图。
- Wan 首尾帧生视频、Wan 图生视频和 Kling 首尾帧生视频。
- 按工作流生成提示词，支持参考图分析、首尾帧过渡分析和姿势预设。
- 聊天式创作流程，支持会话置顶、标题总结、历史分页、编辑后重新生成和删除对话轮次。
- 图片背景移除、2x/4x 放大和批量放大。
- 视频抽帧、帧范围与帧率控制、逐帧编辑、背景处理和颜色替换。
- 导出原始帧 ZIP、精灵图、GIF 和 APNG。
- JWT 登录、邀请码注册、用户配置和创作记录持久化。

## 生成工作流

可选工作流来自 `configs/app_config.yaml` 的 `workflow_defaults.workflow_metadata`，前端通过 `/api/service/workflows` 动态加载。

| ID | 后端 | 输入 | 输出 |
|---|---|---|---|
| `t2i` | ComfyUI / Z-Image | 文本 | 图片 |
| `i2i` | ComfyUI / Q-Image | 1-3 张参考图 | 图片 |
| `nano_banana_pro` | Gemini / Nano Banana | 文本，可选 1-3 张参考图 | 图片 |
| `gpt_image` | OpenAI 兼容 API | 文本，可选 1-3 张参考图 | 图片 |
| `flf2v` | ComfyUI / Wan | 首帧和尾帧 | 视频 |
| `kling_flf2v` | Kling API | 首帧和尾帧 | 视频 |
| `i2v` | ComfyUI / Wan | 起始参考图 | 视频 |

`image_upscale` 和 `image_upscale_invsr` 是内部放大工作流，不会出现在生成工作流选择器中。

## 技术栈

### 后端

- Python 3.10、FastAPI、Uvicorn
- SQLAlchemy 2.0、PostgreSQL 15
- Pydantic v2、pydantic-settings
- JWT、WebSocket
- Pillow、OpenCV、ffmpeg
- rembg、InSPyReNet、BiRefNet
- ComfyUI、Google GenAI、OpenAI 兼容 API、Kling API

### 前端

- React 19、TypeScript 5.9
- Zustand 5、Ant Design 6
- Axios、Vite 7

### 部署

- Docker 多阶段构建：Node 22 构建前端，Python 3.10 运行后端
- Docker Compose：FastAPI、PostgreSQL、Nginx
- SSH Docker Engine：`ssh://nekocon-server`

## 架构概览

```text
Browser
  |-- REST /api/* ----------> Nginx ----------> FastAPI routers
  |-- WebSocket /ws --------> Nginx ----------> ConnectionManager
  |-- /uploads/* -----------> Nginx ----------> uploads volume
                                                   |
FastAPI BackgroundTasks -> AIDrawService singleton |
  |-- ComfyUI HTTP workflows                       |
  |-- Gemini / GPT Image / Kling APIs              |
  |-- media processing helpers                     |
  `-- PostgreSQL <---------------------------------'
```

`POST /api/media/generate` 会快速返回，实际生成在 FastAPI 进程内的后台任务中执行。生成状态和结果通过需要 JWT 的 WebSocket 连接发送。

## 环境要求

### 远程部署

- Docker 和 Docker Compose
- 可用的 SSH 主机别名 `nekocon-server`
- 一台可从后端容器访问的 ComfyUI 服务，用于 ComfyUI 工作流
- 启用外部 API 工作流时，对应的 API 凭据

`docker-compose.yml` 不包含 ComfyUI、Redis 或 TLS 终止服务。生产域名的 HTTPS 由仓库外部的反向代理提供。

### 本地开发

- Python 3.10+
- Node.js 22，或满足 Vite 要求的 Node.js `^20.19.0 || >=22.12.0`
- PostgreSQL 15+
- ffmpeg 和 ffprobe
- 可访问的 ComfyUI 服务

## 配置

复制完整配置清单：

```powershell
Copy-Item .env.example .env
```

配置来源：

| 内容 | 来源 |
|---|---|
| 应用、端口、数据库、认证、模型和外部 API | `.env` |
| 工作流文件映射、元数据和参数默认值 | `configs/app_config.yaml` |
| ComfyUI API 工作流 | `configs/workflows/*.json` |

注意事项：

- `.env.example` 中声明的变量都必须存在，不能通过删除变量来禁用功能。
- 未启用的外部服务可将对应 API Key 留空；URL 和模型名等必填字段仍需保留有效值。
- `AI_PROMPT_REUSE_SESSION_TITLE=true` 时，提示词生成会复用会话标题服务的凭据和模型。
- 注册需要 `INVITE_CODE`，请为 `JWT_SECRET_KEY`、数据库密码和邀请码设置安全值。
- `COMFYUI_HOST=comfyui` 只在该主机名对后端容器可解析时有效；Compose 本身不会创建 ComfyUI 服务。
- Redis 配置目前仅为预留字段，应用没有部署或使用 Redis。
- 不要提交包含真实密钥的 `.env`。

## SSH 远程部署

项目的可部署构建以 Docker 为准。VS Code 中运行默认构建任务 `deploy: remote`，其等价 PowerShell 命令如下：

```powershell
$env:DOCKER_HOST="ssh://nekocon-server"
docker compose down
docker volume rm --force ai-draw_frontend-dist
docker compose build
docker compose up -d
docker compose ps
```

必须删除 `ai-draw_frontend-dist`，否则 Nginx 可能继续提供旧的前端静态文件。该流程只删除前端构建卷，不删除 PostgreSQL、上传文件和 Hugging Face 模型缓存卷。

默认访问地址：

- 线上站点：<https://aidraw.nekocon.cn/>
- 远程 Nginx HTTP：`http://<server>:14601`
- 后端 Swagger：`http://<server>:14600/docs`
- 后端 ReDoc：`http://<server>:14600/redoc`

常用运维命令：

```powershell
$env:DOCKER_HOST="ssh://nekocon-server"
docker compose ps
docker compose logs -f --tail=200
docker compose restart
```

## 本地开发

1. 创建并配置 `.env`。本地运行时至少将数据库和 ComfyUI 主机改为本机可访问地址。
2. 安装后端依赖。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

3. 安装前端依赖。

```powershell
npm --prefix frontend ci
```

4. 启动后端。当前 Vite 开发代理指向 `localhost:8000`，因此本地联调需要将后端端口覆盖为 `8000`。

```powershell
$env:DB_HOST="127.0.0.1"
$env:COMFYUI_HOST="127.0.0.1"
$env:SERVER_PORT="8000"
python run.py
```

5. 在另一个终端启动前端。

```powershell
npm --prefix frontend run dev
```

访问 `http://localhost:5173`。直接按 `.env.example` 的 `SERVER_PORT=14600` 启动后端时，需要同步修改 `frontend/vite.config.ts` 的代理端口。

## API 概览

所有 REST 路由由 FastAPI 挂载在 `/api` 下。

### 公开接口

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/auth/register` | 使用邀请码注册并获取 JWT |
| `POST` | `/api/auth/login` | 登录并获取 JWT |
| `GET` | `/api/service/status` | 后端和 ComfyUI 状态 |
| `GET` | `/api/service/workflows` | 可选工作流元数据 |
| `GET` | `/api/service/workflow/defaults` | 工作流默认配置 |
| `GET` | `/health` | 应用健康信息 |

### 认证接口

| 路径组 | 用途 |
|---|---|
| `/api/media/*` | 生成、上传、抽帧、背景移除、放大和导出 |
| `/api/prompt/*` | 提示词生成、姿势预设、图片和首尾帧分析 |
| `/api/config/user` | 用户配置读取、保存和删除 |
| `/api/chat/*` | 会话、消息、历史和会话配置 |
| `/api/reference-image` | 用户参考图管理 |
| `/api/service/start`、`stop`、`workflow/switch` | 服务控制 |
| `/ws?token=<JWT>` | 生成状态与结果推送 |

错误响应目前兼容统一错误结构和 FastAPI 的 `{"detail": "..."}` 结构，前端 Axios 拦截器会处理两种格式。

## 媒体处理

媒体接口集中在 `server/api/media.py`：

- 视频元数据、帧预览、工作帧集和编辑帧保存。
- rembg、InSPyReNet、BiRefNet 和边缘模式背景处理。
- Lanczos、APISR、Real-CUGAN、Real-ESRGAN 和 InvSR 放大。
- ZIP、spritesheet、GIF、APNG 导出及导出进度查询。

Docker 镜像已安装 ffmpeg。BiRefNet 等 Hugging Face 权重首次使用时会下载到持久化的 `huggingface-cache` 卷。

## 项目结构

```text
ai-draw/
|-- .env.example                 # 完整环境变量清单
|-- .vscode/tasks.json           # SSH 远程部署任务
|-- Dockerfile                   # 前后端多阶段构建
|-- docker-compose.yml           # 远程部署服务和持久卷
|-- run.py                       # 后端启动入口
|-- configs/
|   |-- app_config.yaml          # 工作流元数据和默认值
|   `-- workflows/               # ComfyUI API JSON
|-- server/
|   |-- main.py                  # FastAPI 应用和生命周期
|   |-- ai_draw_service.py       # 生成任务编排
|   |-- api/                     # media、prompt、service、user、session
|   |-- image_upscale_methods.py # 放大方法注册
|   |-- models.py                # SQLAlchemy 模型
|   `-- websocket/               # WebSocket 连接管理
|-- comfyui/                     # ComfyUI 服务和 HTTP 请求实现
|-- utils/                       # 外部 API、存储和媒体处理工具
|-- frontend/
|   |-- src/api/                 # REST 和 WebSocket 客户端
|   |-- src/components/          # 聊天、结果和抽帧工作台
|   |-- src/stores/appStore.ts   # Zustand 全局状态
|   `-- tests/                   # TypeScript 单元测试
|-- tests/                       # Python unittest 测试
`-- nginx/                       # 生产静态资源和反向代理
```

## 验证

```powershell
# Python 单元测试
python -B -m unittest discover -s tests -p "test_*.py"

# 前端单元测试
npm --prefix frontend test

# 前端静态检查与生产构建
npm --prefix frontend run lint
npm --prefix frontend run build
```

Docker 构建是最终的可部署构建路径；当前仓库没有 CI、后端 lint 或后端类型检查配置。

## 添加工作流

### ComfyUI 生成工作流

1. 从 ComfyUI 导出 API JSON 到 `configs/workflows/`。
2. 在 `workflow_files` 中添加文件映射。
3. 在 `workflow_metadata` 中添加前端可见的标签、能力和参数。
4. 检查 `AIDrawService` 的通用分发是否适用；特殊输入或输出需要增加显式分发逻辑。
5. 搜索前端 store、`ChatInput` 和 `SettingsModal` 中按工作流 ID 分支的行为。

### 外部 API 工作流

1. 在 `.env.example` 和 `utils/config_loader.py` 中添加完整配置。
2. 添加 API 客户端和 `AIDrawService` 分发逻辑。
3. 添加 `workflow_metadata`，不需要伪造 ComfyUI JSON。
4. 同步后端 schema、前端 API 类型和特殊参数控件。

## 当前运行约束

- 生成状态由进程内单例 `AIDrawService` 管理，不是按用户隔离的持久任务队列；后端重启会丢失进行中的任务。
- WebSocket 服务状态目前广播给所有已认证连接，前端再按本地任务状态决定是否接收结果。
- `/uploads` 由静态文件服务直接提供，生成文件 URL 不具备逐请求授权。
- 数据库启动使用 `create_all()` 和少量幂等 DDL；仓库尚未建立 Alembic 迁移目录。

## 反馈

问题和建议请提交到 [GitHub Issues](https://github.com/nekocon233/ai-draw/issues)。
