# AI-Draw 代码助手指南

## 项目概述

AI-Draw 是一个基于 FastAPI + React 的 AI 辅助绘画平台，集成 ComfyUI 作为图像生成后端。采用前后端分离架构，通过 WebSocket 实现实时通信。

**当前状态**: 后端已完成 ✅ | 前端开发中 🚧

## 核心架构

### 后端 (FastAPI)

**服务层设计** - 采用单例模式和依赖注入:
- `server/ai_draw_service.py`: 核心服务类 `AIDrawService`，管理 ComfyUI 调用、AI Prompt 生成、状态管理
- `server/dependencies.py`: 使用 `get_ai_draw_service()` 获取全局单例
- `comfyui/comfyui_service.py`: ComfyUI 工作流封装，支持 4 种工作流（参考/上色/图生图/线稿）

**关键模式**:
```python
# 依赖注入模式 - 所有 API 端点通过 Depends 获取服务
@router.post("/api/image/generate")
async def generate_image(service: AIDrawService = Depends(get_service)):
    await service.generate_image(...)
```

**配置系统** - 使用 Pydantic Settings + YAML:
- `configs/app_config.yaml`: 主配置 (服务器、ComfyUI、AI Prompt、**工作流列表**)
- `.env`: 敏感信息 (`AI_PROMPT_API_KEY`, `COMFYUI_PATH`, `COMFYUI_PYTHON`)
- `utils/config_loader.py`: 使用 `get_config()` 获取配置单例
- 环境变量覆盖 YAML 配置，使用 `Field(validation_alias="ENV_VAR")`
- **工作流配置化**: 所有工作流类型从 `app_config.yaml` 的 `workflow_files` 读取，前端通过 `/api/service/workflows` 动态获取，无硬编码

**WebSocket 架构** (`server/websocket/__init__.py`):
- 全局 `ConnectionManager` 管理所有活跃连接
- 服务层通过 `on_state_change` 回调推送状态更新
- 消息格式: `{"type": "state_change", "field": "is_generating", "value": true}`

### 前端 (React + TypeScript)

**状态管理** - Zustand (`frontend/src/stores/appStore.ts`):
```typescript
const { setServiceStatus, isGenerating } = useAppStore();
```

**API 层** (`frontend/src/api/`):
- `client.ts`: Axios 客户端封装
- `services.ts`: REST API 调用
- `websocket.ts`: WebSocket 管理器，支持自动重连

## 开发工作流

### 启动开发环境

**后端**:
```powershell
# 配置 .env 文件
python run.py  # 启动在 http://localhost:8000
```

**前端**:
```powershell
cd frontend
npm install
npm run dev  # 启动在 http://localhost:5173
```

**完整测试**:
1. 启动后端 → 访问 http://localhost:8000/docs 查看 Swagger 文档
2. 启动前端 → WebSocket 自动连接到 `ws://localhost:8000/ws`
3. 确保 ComfyUI 运行在 8188 端口（或在 `.env` 中配置自动启动）

### 工作流配置

所有工作流定义在 `configs/workflows/*.json`，使用 ComfyUI API 格式:
- `common_workflow_api.json`: 通用图生成
- `color_workflow_api.json`: 线稿上色
- `img2img_workflow_api.json`: 图生图
- `lineart_workflow_api.json`: 提取线稿

**添加新工作流**:
1. 在 ComfyUI 中设计工作流并导出为 API JSON
2. 放入 `configs/workflows/`
3. 在 `comfyui_service.py` 的 `workflow_configs` 字典中注册
4. 前端 `WorkflowSelector` 组件会自动获取可用工作流列表

## 项目特定约定

### ComfyUI 集成

- **临时文件处理**: `ComfyUIService` 创建临时工作流文件处理编码问题（utf-8/gbk 自适应）
- **请求接口**: `comfyui/requests/` 抽象本地/云端请求，通过 `comfyui_request_interface.py` 定义接口
- **状态结构**: 使用 `comfyui/structures/` 中的数据类（`ComfyUIRequestState`, `ComfyUIRequestResult`）

### AI Prompt 生成

`utils/ai_prompt.py` 集成 OpenAI 兼容 API（默认 DeepSeek）:
```python
ai_prompt = AIPrompt()  # 自动从配置加载
prompt = ai_prompt.generate("中文描述")  # 返回英文 SD prompt
```

### 图像处理

`utils/image_processor.py` 提供图像编码/解码和预处理功能，用于上传参考图和处理生成结果。

### 错误处理

- FastAPI 端点使用 `HTTPException` 返回标准错误
- WebSocket 推送错误消息格式: `{"type": "error", "message": "..."}`
- 前端通过 `useAppStore` 的 `error` 状态显示错误

## 常见任务指南

### 添加新 API 端点

1. 在 `server/api/__init__.py` 添加路由函数
2. 使用 `Depends(get_service)` 注入 `AIDrawService`
3. 返回 Pydantic 模型或字典（自动序列化为 JSON）
4. 在 `frontend/src/api/services.ts` 添加对应的客户端方法

### 修改服务层逻辑

编辑 `server/ai_draw_service.py`，状态变化通过 `_notify_state_change()` 自动推送到前端:
```python
self.is_generating = True
self._notify_state_change('is_generating', True)  # WebSocket 广播
```

### 调试 WebSocket

- 后端日志显示连接数: `[WebSocket] 客户端已连接，当前连接数: 1`
- 前端开发者工具 → Network → WS 查看消息
- 使用 `wsManager.subscribe(msg => console.log(msg))` 监听所有消息

## Docker 部署

```powershell
docker-compose up -d  # 启动容器化服务
```

注意: Docker 配置中需要挂载 `.env` 文件以传递 API 密钥。

## 关键文件索引

- `server/main.py`: FastAPI 应用入口，生命周期管理
- `server/ai_draw_service.py`: 核心业务逻辑
- `comfyui/comfyui_service.py`: ComfyUI 工作流管理
- `utils/config_loader.py`: 配置加载和验证
- `frontend/src/App.tsx`: React 应用入口
- `frontend/src/stores/appStore.ts`: 全局状态管理
