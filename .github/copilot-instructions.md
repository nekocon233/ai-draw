# AI-Draw 代码助手指南

## 项目概述

AI-Draw 是一个基于 FastAPI + React 的 AI 辅助绘画 Web 平台，集成 ComfyUI 作为图像/视频生成后端，并额外支持 Google Gemini 多轮对话图像生成。采用前后端分离架构，通过 WebSocket 实现实时通信，支持用户认证和多会话管理。

**当前状态**: v2.x 稳定版 ✅ | 全栈完成 | 生产可用 🚀

## 技术栈

### 后端
- **FastAPI** - Python Web 框架
- **SQLAlchemy 2.0** - ORM 数据库操作
- **PostgreSQL 15** - 关系型数据库
- **JWT (python-jose)** - 用户认证
- **WebSocket** - 实时双向通信
- **Pydantic v2 + pydantic-settings** - 配置管理
- **Alembic** - 数据库迁移（已引入依赖，未配置迁移脚本）
- **google-generativeai** - Gemini API 客户端（延迟导入）

### 前端
- **React 19** + **TypeScript 5.9**
- **Zustand 5** - 状态管理
- **Ant Design 6** - UI 组件库
- **Vite 7** - 构建工具
- **Axios** - HTTP 客户端

## 核心架构

### 后端 (FastAPI)

**模块化 API 设计** - 按功能拆分为独立模块:
- `server/api/media.py`: 媒体生成相关 API（图像 / 视频），路由前缀 `/media`
- `server/api/prompt.py`: AI Prompt 生成
- `server/api/service.py`: 服务状态、工作流配置
- `server/api/user.py`: 用户认证、配置管理
- `server/api/session.py`: 会话管理、聊天历史
- `server/schemas.py`: 所有 Pydantic 请求/响应模型（`GenerateMediaRequest`, `GenerateMediaResponse` 等）

**服务层设计** - 采用单例模式和依赖注入:
- `server/ai_draw_service.py`: 核心服务类 `AIDrawService`，管理 ComfyUI 调用、Gemini 调用、AI Prompt 生成、状态管理
- 使用 `get_ai_draw_service()` 获取全局单例
- `comfyui/comfyui_service.py`: ComfyUI 工作流封装

**关键模式**:
```python
# 依赖注入模式 - 所有 API 端点通过 Depends 获取服务
from server.ai_draw_service import get_ai_draw_service
from server.schemas import GenerateMediaRequest, GenerateMediaResponse

@router.post("/media/generate", response_model=GenerateMediaResponse)
async def generate_media(
    request: GenerateMediaRequest,
    background_tasks: BackgroundTasks,
    service: AIDrawService = Depends(get_ai_draw_service)
):
    # 立即返回，实际生成通过 BackgroundTasks 异步执行，结果由 WebSocket 推送
    background_tasks.add_task(_run_generation)
    return GenerateMediaResponse(count=0, images=[])
```

**数据库模型** (`server/models.py`):
- `User`: 用户表（用户名、密码哈希、邮箱）
- `UserConfig`: 用户配置表（工作流、提示词、参数）
- `ChatSession`: 聊天会话表（标题、配置、时间戳，含 flf2v 视频参数和多参考图字段）
- `ChatMessage`: 聊天消息表（内容、生成参数，含 flf2v 视频参数和多参考图字段）
- `GeneratedImage`: 生成图片表（与 `ChatMessage` 外键关联，独立存储每张生成图片路径）
- `ReferenceImage`: 参考图片表

`ChatSession` 和 `ChatMessage` 新增的扩展字段（相对于基础版本）:
- `config_reference_image_2/3`、`reference_image_2/3`: i2i 多参考图（最多 3 张）
- `config_prompt_end`、`prompt_end`: flf2v 结束帧提示词
- `config_reference_image_end`、`reference_image_end`: flf2v 结束帧图片
- `config_is_loop`、`config_start_frame_count`、`config_end_frame_count`、`config_frame_rate` / 对应消息字段: flf2v 视频参数

**配置系统** - 单一数据源原则:
- **环境变量优先**: 端口、密钥、数据库连接等通过 `.env` 和 `docker-compose.yml` 配置
- `configs/app_config.yaml`: 仅保留工作流配置（复杂结构）
- `utils/config_loader.py`: 使用 Pydantic Settings，`Field(validation_alias="ENV_VAR")` 映射环境变量

**WebSocket 架构** (`server/websocket/__init__.py`):
- 全局 `ConnectionManager` 管理连接，支持会话 ID 关联
- 服务层通过 `on_state_change` 回调推送状态更新
- 消息格式: `{"type": "state_change", "field": "is_generating", "value": true}`

### 前端 (React + TypeScript)

**状态管理** - Zustand (`frontend/src/stores/appStore.ts`):
```typescript
const { 
  sessions, currentSessionId, chatHistory,
  isGenerating, currentWorkflow, availableWorkflows,
  prompt, loraPrompt, strength, count,
  // flf2v 视频参数
  promptEnd, referenceImageEnd, isLoop,
  startFrameCount, endFrameCount, frameRate,
  // i2i 多参考图
  referenceImage2, referenceImage3,
  // 其他扩展
  width, height, useOriginalSize,
  nanoBananaSendHistory, workflowImageStash,
  currentGeneratingMessageId,
  setServiceStatus, loadAvailableWorkflows
} = useAppStore();
```

**API 层** (`frontend/src/api/`):
- `client.ts`: Axios 客户端封装，自动附加 JWT Token
- `services.ts`: REST API 调用（认证、会话、配置、生成；含 `deleteMessage()`、`updateMessageContent()`）
- `websocket.ts`: WebSocket 管理器，支持自动重连

**类型定义** (`frontend/src/types/`):
- `api.ts`: API 请求/响应类型（`WorkflowMetadata`, `GenerateMediaRequest`）
- `models.ts`: 数据模型（`ChatSession`, `UserConfig`）
- `store.ts`: Zustand Store 类型

## 开发工作流

### Docker 部署（推荐）

```bash
# 首次部署
docker compose up -d

# 重新构建（代码更新后）
docker compose down && docker compose build --no-cache ai-draw-backend && docker compose up -d

# 查看日志
docker compose logs -f ai-draw-backend
```

### 本地开发

**后端**:
```bash
# 配置 .env 文件
python run.py  # 启动在 http://localhost:14600
```

**前端**:
```bash
cd frontend
npm install
npm run dev  # 启动在 http://localhost:5173
```

**测试环境**:
- 后端 API: http://localhost:14600/docs (Swagger UI)
- 前端开发: http://localhost:5173
- 生产前端: http://localhost:14601 (Nginx)
- WebSocket: `ws://localhost:14600/ws`

### 工作流配置

所有工作流定义在 `configs/workflows/*.json`，元数据在 `configs/app_config.yaml`:

| 工作流 ID | 名称 | 需要参考图 | 输出类型 | 工作流文件 |
|-----------|------|-----------|----------|-----------|
| `t2i` | 文生图（Z-Image） | ❌ | image | `t2i_workflow_api.json` |
| `i2i` | 图生图（Q-Image） | ✅（最多 3 张） | image | `qwen_image_edit_workflow_api.json` |
| `reference` | 参考图（SDXL） | ✅ | image | `reference_workflow_api.json` |
| `reference_zimage` | 参考图（Z-Image） | ✅ | image | `reference_zimage_workflow_api.json` |
| `flf2v` | 首尾帧生视频 | ✅（需起始帧和结束帧） | **video** | `flf2v_workflow_api.json` |
| `nano_banana_pro` | 图生图（Nano Banana Pro） | 可选 | image | `nano_banana_pro_workflow_api.json` |

`workflow_metadata` 中每个工作流支持的元数据字段（`app_config.yaml`）:
- `label`, `description`, `requires_image`, `parameters`: 基础字段
- `prompt_template`: 每个工作流专属的 AI Prompt 生成模板
- `requires_end_image`: 是否需要结束帧图片（flf2v）
- `supports_original_size`: 是否支持原图尺寸
- `supports_loop`: 是否支持循环生成
- `output_type`: 输出类型（`"image"` | `"video"`）

**添加新工作流**:
1. 在 ComfyUI 中设计工作流并导出为 API JSON
2. 放入 `configs/workflows/`
3. 在 `app_config.yaml` 的 `workflow_files` 添加文件映射
4. 在 `workflow_metadata` 添加元数据（含上述扩展字段）
5. 前端通过 `/api/service/workflows` 自动获取

## 项目特定约定

### ComfyUI 集成

- **临时文件处理**: `ComfyUIService` 创建临时工作流文件，自动适配 utf-8/gbk 编码
- **请求接口**: `comfyui/requests/` 抽象本地/云端请求，通过 `comfyui_request_interface.py` 定义接口
- **状态结构**: 使用 `comfyui/structures/` 中的数据类
- **Docker 环境**: 通过 `COMFYUI_HOST=host.docker.internal`（Windows/Mac）或 `172.17.0.1`（Linux）访问宿主机

### Gemini 集成（nano_banana_pro 工作流）

`utils/gemini_chat.py` 封装 Google Gemini 多轮对话图像生成，使用 `NANO_BANANA_API_KEY` 环境变量：

```python
# nano_banana_pro 三种路由逻辑（在 ai_draw_service.py 中实现）:
# 1. 有参考图                      → 走 ComfyUI 工作流
# 2. 无参考图 + send_history=True  → 走 GeminiChat 多轮对话（携带当前会话历史）
# 3. 无参考图 + send_history=False → 走 GeminiChat 单轮生成

gemini = GeminiChat(api_key=os.getenv("NANO_BANANA_API_KEY"))
result_images = gemini.generate(
    current_prompt=prompt,
    history=chat_history,   # 格式: [{"prompt", "images", "result_images"}, ...]
)
```

> **注意**: `NANO_BANANA_API_KEY` 通过 `os.getenv()` 直接读取，未注册进 `config_loader.py` 的配置类，需在 `.env` 中手动配置。

### 视频生成（flf2v 工作流）

`flf2v` 工作流需要起始帧图片和结束帧图片，输出视频文件：

- `utils/media_processor.py`: 提供 `resize_image_base64()`（cover 模式图像缩放）和 `resize_video_bytes()`（调用系统 ffmpeg 进行视频 resize，输出 h264 mp4）
- `utils/thread_runner.py`: 单例 `ThreadRunner`，在独立线程的独立事件循环中执行异步任务，避免阻塞 FastAPI 主事件循环。Gemini 调用等耗时同步操作通过此类调度

```python
from utils.thread_runner import ThreadRunner

runner = ThreadRunner()  # 单例，全局共享同一事件循环
runner.run_thread_async(my_async_func, prefix="[任务名]")
```

### 用户认证

`server/auth.py` 提供 JWT 认证:
```python
from server.auth import get_current_user, get_optional_user

# 强制认证
@router.get("/protected")
async def protected_route(user: User = Depends(get_current_user)):
    pass

# 可选认证（支持游客）
@router.get("/optional")
async def optional_route(user: User | None = Depends(get_optional_user)):
    pass
```

### AI Prompt 生成

`utils/ai_prompt.py` 集成 OpenAI 兼容 API（默认 DeepSeek）:
```python
ai_prompt = AIPrompt()  # 自动从环境变量加载
prompt = await asyncio.to_thread(ai_prompt.generate, "中文描述")
```

每个工作流可在 `app_config.yaml` 的 `prompt_template` 字段配置专属模板，覆盖全局默认模板。

### 媒体存储

`utils/file_storage.py` 管理上传文件:
- 登录用户: 图片/视频保存到 `uploads/` 目录，生成结果以独立记录存入 `GeneratedImage` 表
- 游客模式: 媒体存储在 IndexedDB (前端)

### 错误处理

- **后端**: `server/middleware/error_handler.py` 统一异常处理
- **前端**: `ErrorBoundary` 组件捕获渲染错误
- **WebSocket**: `{"type": "error", "message": "..."}` 格式推送

## 常见任务指南

### 添加新 API 端点

1. 在 `server/api/` 对应模块添加路由函数（或创建新模块）
2. 在 `server/schemas.py` 定义 Pydantic 请求/响应模型
3. 使用 `Depends(get_ai_draw_service)` 注入服务
4. 需要认证时使用 `Depends(get_current_user)` 或 `Depends(get_optional_user)`
5. 在 `server/api/__init__.py` 注册新路由
6. 在 `frontend/src/api/services.ts` 添加客户端方法
7. 在 `frontend/src/types/api.ts` 定义类型

### 修改数据库模型

1. 编辑 `server/models.py`
2. 应用会自动创建新表（SQLAlchemy `create_all`）
3. 如需字段迁移，使用 Alembic（已引入 `alembic==1.13.1` 依赖，但迁移脚本尚未配置）

### 修改服务层逻辑

编辑 `server/ai_draw_service.py`，状态变化自动推送:
```python
self.is_generating = True
self._notify_state_change('is_generating', True)  # WebSocket 广播
```

### 调试 WebSocket

- 后端日志: `[WebSocket] 客户端已连接，会话ID: xxx，当前连接数: 1`
- 前端开发者工具 → Network → WS 查看消息

## 关键文件索引

### 后端
- `server/main.py`: FastAPI 入口，生命周期管理
- `server/ai_draw_service.py`: 核心业务逻辑（ComfyUI + Gemini 路由）
- `server/schemas.py`: Pydantic 请求/响应模型
- `server/api/`: 模块化 API 路由（`media.py`, `prompt.py`, `service.py`, `user.py`, `session.py`）
- `server/models.py`: SQLAlchemy ORM 模型
- `server/database.py`: 数据库连接和会话管理
- `server/auth.py`: JWT 认证
- `server/websocket/__init__.py`: WebSocket 管理
- `comfyui/comfyui_service.py`: ComfyUI 工作流管理
- `utils/config_loader.py`: 配置加载（Pydantic Settings）
- `utils/gemini_chat.py`: Gemini 多轮对话图像生成封装
- `utils/media_processor.py`: 图像/视频 resize 工具（依赖系统 ffmpeg）
- `utils/thread_runner.py`: 单例线程运行器（独立事件循环）

### 前端
- `frontend/src/App.tsx`: React 应用入口
- `frontend/src/stores/appStore.ts`: Zustand 状态管理
- `frontend/src/api/`: API 客户端
- `frontend/src/components/`: UI 组件
- `frontend/src/types/`: TypeScript 类型定义

### 配置
- `docker-compose.yml`: Docker 服务编排
- `.env`: 环境变量（密钥、数据库、`NANO_BANANA_API_KEY` 等）
- `configs/app_config.yaml`: 工作流配置
