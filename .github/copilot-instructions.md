# AI-Draw 代码助手指南

## 项目概述

AI-Draw 是一个基于 FastAPI + React 的 AI 辅助绘画 Web 平台，集成 ComfyUI 作为图像生成后端。采用前后端分离架构，通过 WebSocket 实现实时通信，支持用户认证和多会话管理。

**当前状态**: v2.0 稳定版 ✅ | 全栈完成 | 生产可用 🚀

## 技术栈

### 后端
- **FastAPI** - Python Web 框架
- **SQLAlchemy 2.0** - ORM 数据库操作
- **PostgreSQL 15** - 关系型数据库
- **JWT (python-jose)** - 用户认证
- **WebSocket** - 实时双向通信
- **Pydantic v2 + pydantic-settings** - 配置管理

### 前端
- **React 19** + **TypeScript 5.9**
- **Zustand 5** - 状态管理
- **Ant Design 6** - UI 组件库
- **Vite 7** - 构建工具
- **Axios** - HTTP 客户端

## 核心架构

### 后端 (FastAPI)

**模块化 API 设计** - 按功能拆分为独立模块:
- `server/api/image.py`: 图像生成相关 API
- `server/api/prompt.py`: AI Prompt 生成
- `server/api/service.py`: 服务状态、工作流配置
- `server/api/user.py`: 用户认证、配置管理
- `server/api/session.py`: 会话管理、聊天历史

**服务层设计** - 采用单例模式和依赖注入:
- `server/ai_draw_service.py`: 核心服务类 `AIDrawService`，管理 ComfyUI 调用、AI Prompt 生成、状态管理
- 使用 `get_ai_draw_service()` 获取全局单例
- `comfyui/comfyui_service.py`: ComfyUI 工作流封装

**关键模式**:
```python
# 依赖注入模式 - 所有 API 端点通过 Depends 获取服务
from server.ai_draw_service import get_ai_draw_service

@router.post("/image/generate")
async def generate_image(
    request: GenerateImageRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
):
    images = await service.generate_image(...)
```

**数据库模型** (`server/models.py`):
- `User`: 用户表（用户名、密码哈希、邮箱）
- `UserConfig`: 用户配置表（工作流、提示词、参数）
- `ChatSession`: 聊天会话表（标题、配置、时间戳）
- `ChatMessage`: 聊天消息表（内容、图片 URL、参数）
- `ReferenceImage`: 参考图片表

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
  setServiceStatus, loadAvailableWorkflows
} = useAppStore();
```

**API 层** (`frontend/src/api/`):
- `client.ts`: Axios 客户端封装，自动附加 JWT Token
- `services.ts`: REST API 调用（认证、会话、配置、生成）
- `websocket.ts`: WebSocket 管理器，支持自动重连

**类型定义** (`frontend/src/types/`):
- `api.ts`: API 请求/响应类型（`WorkflowMetadata`, `GenerateImageRequest`）
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

| 工作流 ID | 名称 | 需要参考图 |
|-----------|------|-----------|
| `t2i` | 文生图（Z-Image） | ❌ |
| `i2i` | 图生图（Q-Image） | ✅ |
| `reference` | 参考图（SDXL） | ✅ |
| `reference_zimage` | 参考图（Z-Image） | ✅ |

**添加新工作流**:
1. 在 ComfyUI 中设计工作流并导出为 API JSON
2. 放入 `configs/workflows/`
3. 在 `app_config.yaml` 的 `workflow_files` 添加文件映射
4. 在 `workflow_metadata` 添加元数据（label, description, requires_image, parameters）
5. 前端通过 `/api/service/workflows` 自动获取

## 项目特定约定

### ComfyUI 集成

- **临时文件处理**: `ComfyUIService` 创建临时工作流文件，自动适配 utf-8/gbk 编码
- **请求接口**: `comfyui/requests/` 抽象本地/云端请求，通过 `comfyui_request_interface.py` 定义接口
- **状态结构**: 使用 `comfyui/structures/` 中的数据类
- **Docker 环境**: 通过 `COMFYUI_HOST=host.docker.internal`（Windows/Mac）或 `172.17.0.1`（Linux）访问宿主机

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

### 图像存储

`utils/file_storage.py` 管理上传文件:
- 登录用户: 图片保存到 `uploads/` 目录，数据库存储相对路径
- 游客模式: 图片存储在 IndexedDB (前端)

### 错误处理

- **后端**: `server/middleware/error_handler.py` 统一异常处理
- **前端**: `ErrorBoundary` 组件捕获渲染错误
- **WebSocket**: `{"type": "error", "message": "..."}` 格式推送

## 常见任务指南

### 添加新 API 端点

1. 在 `server/api/` 对应模块添加路由函数（或创建新模块）
2. 使用 `Depends(get_ai_draw_service)` 注入服务
3. 需要认证时使用 `Depends(get_current_user)` 或 `Depends(get_optional_user)`
4. 在 `server/api/__init__.py` 注册新路由
5. 在 `frontend/src/api/services.ts` 添加客户端方法
6. 在 `frontend/src/types/api.ts` 定义类型

### 修改数据库模型

1. 编辑 `server/models.py`
2. 应用会自动创建新表（SQLAlchemy `create_all`）
3. 如需迁移，使用 Alembic（项目暂未集成）

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
- `server/ai_draw_service.py`: 核心业务逻辑
- `server/api/`: 模块化 API 路由
- `server/models.py`: SQLAlchemy ORM 模型
- `server/database.py`: 数据库连接和会话管理
- `server/auth.py`: JWT 认证
- `server/websocket/__init__.py`: WebSocket 管理
- `comfyui/comfyui_service.py`: ComfyUI 工作流管理
- `utils/config_loader.py`: 配置加载

### 前端
- `frontend/src/App.tsx`: React 应用入口
- `frontend/src/stores/appStore.ts`: Zustand 状态管理
- `frontend/src/api/`: API 客户端
- `frontend/src/components/`: UI 组件
- `frontend/src/types/`: TypeScript 类型定义

### 配置
- `docker-compose.yml`: Docker 服务编排
- `.env`: 环境变量（密钥、数据库等）
- `configs/app_config.yaml`: 工作流配置
