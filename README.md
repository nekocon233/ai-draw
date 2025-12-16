# AI-Draw

> AI 辅助绘画工具，基于 ComfyUI 的智能图像生成平台

## 🎉 v1.1 重构完成

**当前状态**: 代码架构重构完成 ✅ | 功能稳定运行 🚀

- ✅ 后端模块化架构（API 拆分为独立模块）
- ✅ 前端工具函数和常量提取
- ✅ 用户认证和数据持久化
- ✅ 聊天历史和参考图保存
- 📝 详细重构文档：[REFACTORING.md](./REFACTORING.md)
- 📋 后续优化计划：[OPTIMIZATION_TODO.md](./OPTIMIZATION_TODO.md)

## 项目简介

AI-Draw 是一个现代化的 AI 辅助绘画 Web 应用，为插画师、设计师和创作者提供便捷的 AI 图像生成能力。采用 FastAPI + React 前后端分离架构，通过简单的提示词和参数设置，结合本地或云端 ComfyUI 后端，即可一键生成高质量的创意图像。

## 主要特性

- 🎨 **多种工作流**：支持"参考"、"上色"、"图生图"、"线稿"四种专业工作流
- 🤖 **智能 Prompt 生成**：接入 DeepSeek AI，根据中文描述自动生成英文提示词
- ⚡ **实时通信**：基于 WebSocket 的实时状态推送和进度更新
- 🖼️ **图片上传**：支持拖拽、粘贴、文件选择多种图片上传方式
- 🎛️ **精准控制**：重绘强度、生成数量、LoRA 提示词等参数可调
- 📊 **批量生成**：支持一次生成多张图像（1-8 张）
- 🌐 **现代化界面**：React + TypeScript + Ant Design 构建的响应式 UI
- 🔧 **灵活配置**：YAML + 环境变量配置，支持本地/云端 ComfyUI

## 技术栈

### 后端
- **FastAPI** - 现代 Python Web 框架
- **WebSocket** - 实时双向通信
- **Pydantic** - 数据验证和配置管理
- **SQLAlchemy** - ORM 数据库操作
- **PostgreSQL** - 关系型数据库
- **JWT** - 用户认证和授权
- **ComfyUI** - AI 图像生成后端

### 前端
- **React 18** + **TypeScript** - 现代前端框架
- **Zustand** - 轻量级状态管理
- **Ant Design** - 企业级 UI 组件库
- **Axios** - HTTP 客户端
- **Vite** - 快速构建工具
## 快速开始

### 环境要求
- Python 3.13+
- Node.js 18+
- PostgreSQL 16+
- ComfyUI（本地或云端）

### 安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/nekocon233/ai-draw.git
   cd ai-draw
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件，填入必要配置
   ```

3. **安装后端依赖**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate  # Windows
   pip install -r requirements.txt
   ```

4. **配置数据库**
   - 创建 PostgreSQL 数据库：`ai-draw`
   - 在 `.env` 中配置数据库连接信息
   - 运行 `python init_db.py` 初始化数据库表

5. **安装前端依赖**
   ```bash
   cd frontend
   npm install
   ```

6. **启动服务**
   ```bash
   # 后端（项目根目录）
   python run.py
   
   # 前端（frontend目录）
   npm run dev
   ```

7. **访问应用**
   - 前端：http://localhost:5173
   - 后端 API：http://localhost:8000/docs

### Docker 部署 🐳

**快速启动**（推荐用于生产环境）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入数据库密码、API密钥等

# 2. 启动所有服务（开发模式 - 支持热重载）
docker-compose up -d

# 3. 查看运行状态
docker-compose ps

# 4. 查看日志
docker-compose logs -f ai-draw-backend

# 5. 停止服务
docker-compose down
```

**生产环境部署**

```bash
# 使用生产配置（多worker、资源限制、Redis缓存）
docker-compose -f docker-compose.prod.yml up -d

# 数据库迁移
docker exec ai-draw-backend alembic upgrade head

# 查看服务健康状态
docker-compose -f docker-compose.prod.yml ps
```

**Docker 优势**：
- ✅ 一键部署，包含后端、数据库、Redis
- ✅ 环境隔离，无需安装 Python/PostgreSQL
- ✅ 支持热重载（开发模式）
- ✅ 健康检查、自动重启
- ✅ 可选 Nginx 反向代理

📖 **详细文档**: [DOCKER.md](./DOCKER.md)

### ComfyUI 配置

AI-Draw 需要 ComfyUI 作为图像生成后端。有两种方式：

1. **本地 ComfyUI**（推荐）
   - 在 `.env` 中配置 `COMFYUI_PATH` 和 `COMFYUI_PYTHON`
   - 启动后端时会自动启动 ComfyUI 服务
   - 或手动启动 ComfyUI（默认端口 8188）

2. **云端 ComfyUI**
   - 在 `configs/app_config.yaml` 中配置云端 API 地址

3. **Docker 环境访问宿主机 ComfyUI**
   - Windows/Mac: `COMFYUI_URL=http://host.docker.internal:8188`
   - Linux: `COMFYUI_URL=http://172.17.0.1:8188`

## 配置文件说明

### configs/app_config.yaml

主配置文件，包含：
- 服务器端口、CORS 设置
- ComfyUI 连接配置
- AI Prompt 生成配置
- 路径配置

### .env

敏感信息和本地配置：
- `AI_PROMPT_API_KEY` - DeepSeek/OpenAI API 密钥
- `COMFYUI_PATH` - ComfyUI 安装路径（可选）
- `COMFYUI_PYTHON` - ComfyUI Python 解释器路径（可选）

## API 文档

启动服务后访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 主要端点

- `POST /api/service/start` - 启动 ComfyUI 服务
- `POST /api/service/stop` - 停止服务
- `GET /api/service/status` - 检查服务状态
- `POST /api/prompt/generate` - 生成 AI Prompt
- `POST /api/image/generate` - 生成图像
- `POST /api/image/upload` - 上传参考图片
- `DELETE /api/previews` - 清除预览图片
- `WS /ws` - WebSocket 实时通信

## 项目结构

```
ai-draw/
├── server/                 # FastAPI 后端
│   ├── main.py            # 应用入口
│   ├── ai_draw_service.py # 核心服务层
│   ├── api/               # REST API 路由
│   ├── websocket/         # WebSocket 处理
│   └── dependencies.py    # 依赖注入
├── frontend/              # React 前端（待开发）
├── comfyui/              # ComfyUI 集成
│   ├── comfyui_service.py # ComfyUI 服务
│   └── requests/          # 本地/云端请求
├── utils/                # 工具模块
│   ├── config_loader.py  # 配置加载
│   ├── ai_prompt.py      # AI Prompt 生成
│   └── image_processor.py # 图像处理
├── configs/              # 配置文件
│   ├── app_config.yaml   # 主配置
│   └── workflows/        # 工作流 JSON
├── .env.example       # 环境变量模板
└── requirements.txt   # Python 依赖

## 快速开始

### 1. 检查系统要求

- Python 3.8+
- Node.js 18+ (用于前端开发)
- ComfyUI (本地或云端)

### 2. 克隆项目

```bash
git clone https://github.com/nekocon233/ai-draw.git
cd ai-draw
```

### 3. 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置 API 密钥
# AI_PROMPT_API_KEY=your-deepseek-api-key

# (可选) 配置本地 ComfyUI 自动启动
# COMFYUI_PATH=E:\ComfyUI
# COMFYUI_PYTHON=E:\ComfyUI\python\python.exe
```

### 4. 创建虚拟环境并安装依赖

```bash
# Windows
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 5. 启动服务

```bash
# 方式 1: 使用启动脚本（推荐）
python run.py

# 方式 2: 直接使用 uvicorn
uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
```

### 6. 验证服务

```bash
# 运行验证脚本
python verify_backend.py
```

如果看到 "✅ 所有基础功能正常!", 说明后端已就绪!

### 7. 访问服务

- 🌐 API 文档: http://localhost:8000/docs
- 📡 WebSocket: ws://localhost:8000/ws
- 🚧 前端界面: (开发中)

## 使用说明

### API 使用示例

```python
import requests

# 1. 生成 Prompt
response = requests.post('http://localhost:8000/api/prompt/generate', 
    json={'description': '一个可爱的猫咪'})
prompt = response.json()['prompt']

# 2. 生成图像
response = requests.post('http://localhost:8000/api/image/generate',
    json={
        'prompt': prompt,
        'workflow_type': '参考',
        'strength': 0.5,
        'count': 1
    })
```

### WebSocket 实时推送

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('状态更新:', data);
};
```

## 用户认证与多用户支持

### 功能特性
- ✅ **用户注册/登录**：支持多用户独立账户
- ✅ **配置持久化**：用户配置自动保存到数据库
- ✅ **聊天历史**：每个用户的对话和生成记录独立存储
- ✅ **数据隔离**：用户之间数据完全隔离，互不影响
- ✅ **游客模式**：未登录也可使用，但配置不保存

### 使用说明

1. **游客使用**：
   - 无需登录即可使用所有功能
   - 配置仅保存在浏览器本地
   - 刷新页面后配置重置

2. **注册账户**：
   - 点击右上角"登录"按钮
   - 切换到"注册" Tab
   - 填写用户名、密码（邮箱可选）
   - 注册成功后自动登录

3. **登录使用**：
   - 配置自动保存到数据库
   - 聊天历史永久保存
   - 支持多设备同步
   - 右上角显示用户名

4. **退出登录**：
   - 点击右上角用户名
   - 选择"退出登录"
   - 返回游客模式

### 数据隔离机制
```
用户A (Token_A)
  ├── 配置：工作流A、提示词A、参数A
  ├── 聊天记录A（最近50条自动加载）
  └── 参考图片A

用户B (Token_B)
  ├── 配置：工作流B、提示词B、参数B
  ├── 聊天记录B（最近50条自动加载）
  └── 参考图片B
```

## 项目结构

```
ai-draw/
├── run.py                # 应用启动入口
├── requirements.txt      # Python依赖
├── .env                  # 环境变量配置（需复制.env.example）
├── init_db.py            # 数据库初始化脚本
│
├── server/              # FastAPI后端
│   ├── main.py                 # FastAPI应用入口
│   ├── ai_draw_service.py      # 核心业务服务
│   ├── dependencies.py         # 依赖注入
│   ├── database.py             # 数据库连接
│   ├── models.py               # ORM模型（User, Config, Message等）
│   ├── auth.py                 # JWT认证
│   ├── api/                    # REST API端点
│   │   ├── __init__.py         # 图像生成、工作流等API
│   │   └── user.py             # 用户认证、配置管理API
│   └── websocket/              # WebSocket实时通信
│       └── __init__.py
│
├── comfyui/             # ComfyUI集成
│   ├── comfyui_service.py      # ComfyUI服务封装
│   ├── requests/               # 请求处理（本地/云端）
│   └── structures/             # 数据结构定义
│
├── configs/             # 配置文件
│   ├── app_config.yaml         # 应用主配置
│   └── workflows/              # ComfyUI工作流JSON
│       ├── reference_workflow_api.json
│       ├── color_workflow_api.json
│       ├── img2img_workflow_api.json
│       └── lineart_workflow_api.json
│
├── utils/               # 工具模块
│   ├── config_loader.py        # 配置加载器
│   ├── ai_prompt.py            # AI提示词生成
│   ├── image_processor.py      # 图像处理
│   └── thread_runner.py        # 线程管理
│
└── frontend/            # React前端
    ├── src/
    │   ├── App.tsx             # 应用主组件
    │   ├── main.tsx            # 入口文件
    │   ├── api/                # API客户端
    │   │   ├── client.ts       # Axios配置（Token拦截）
    │   │   ├── services.ts     # API方法封装
    │   │   └── websocket.ts    # WebSocket管理器
    │   ├── components/         # UI组件
    │   │   ├── LoginModal.tsx  # 登录/注册弹窗
    │   │   ├── StatusBar.tsx   # 状态栏（登录入口）
    │   │   ├── ChatInput.tsx   # 聊天输入框
    │   │   ├── ResultGrid.tsx  # 结果展示网格
    │   │   └── ...             # 其他组件
    │   ├── stores/             # Zustand状态管理
    │   │   └── appStore.ts     # 应用全局状态
    │   └── types/              # TypeScript类型定义
    └── package.json
```

## 开发指南

### 后端开发

**核心服务层**（单例模式）：
```python
# server/ai_draw_service.py
class AIDrawService:
    def __init__(self):
        self.comfyui_service = ComfyUIService()
        self.ai_prompt = AIPrompt()
    
    async def generate_image(self, prompt, workflow, ...):
        # 图像生成逻辑
        pass
```

**依赖注入**：
```python
# server/dependencies.py
def get_ai_draw_service() -> AIDrawService:
    return _service_instance

# API端点使用
@router.post("/api/image/generate")
async def generate(service: AIDrawService = Depends(get_service)):
    await service.generate_image(...)
```

**数据库模型**：
- `User` - 用户表（用户名、密码哈希、邮箱）
- `UserConfig` - 用户配置（工作流、提示词、参数）
- `ChatMessage` - 聊天记录（用户消息、AI响应）
- `GeneratedImage` - 生成的图片（文件路径、关联消息）
- `ReferenceImage` - 参考图片（文件路径、是否当前使用）

### 前端开发

**状态管理**（Zustand）：
```typescript
// stores/appStore.ts
const { 
  prompt, setPrompt,           // 提示词
  currentWorkflow,              // 当前工作流
  chatHistory,                  // 聊天历史
  loadUserConfig,               // 加载用户配置
  saveChatMessage               // 保存聊天消息
} = useAppStore();
```

**API调用**：
```typescript
// api/services.ts
await apiService.login({ username, password });
await apiService.getUserConfig();
await apiService.updateUserConfig({ prompt: '1girl' });
await apiService.generateImage({ prompt, workflow, ... });
```

**WebSocket监听**：
```typescript
// api/websocket.ts
wsManager.subscribe((message) => {
  if (message.type === 'state_change') {
    // 处理状态变化
  }
  if (message.field === 'image_generated') {
    // 处理图片生成完成
  }
});
```

### 配置系统

**主配置**（`configs/app_config.yaml`）：
```yaml
server:
  host: "0.0.0.0"
  port: 8000

comfyui:
  local:
    host: "127.0.0.1"
    port: 8188

ai_prompt:
  api_url: "https://api.deepseek.com/v1/chat/completions"
  model: "deepseek-chat"
```

**环境变量**（`.env`）：
```env
AI_PROMPT_API_KEY=sk-your-api-key
DATABASE_HOST=localhost
DATABASE_NAME=ai-draw
COMFYUI_PATH=path/to/comfyui
```

## 更新日志

### v2.0 (2025-12-15)

- ✨ **全新架构**：FastAPI + React 前后端分离
- ✨ **用户系统**：支持注册/登录，多用户数据隔离
- ✨ **配置持久化**：用户配置自动保存到PostgreSQL
- ✨ **聊天历史**：对话记录永久保存，支持加载历史
- 🎨 **现代UI**：Ant Design 5.x，响应式设计
- ⚡ **实时通信**：WebSocket推送生成状态和进度
- 🔧 **灵活部署**：支持本地/云端ComfyUI
- 📱 **移动友好**：适配多种屏幕尺寸

### v1.x (旧版Krita插件)

- 支持自动调整提示词输入框高度
- 新增"生成Prompt"按钮，可根据描述自动生成英文提示词
- 优化UI体验，参数滑块与输入框联动
- 支持多AI后端扩展

## 常见问题

### 安装与配置
- **Q: ComfyUI连接失败？**  
  A: 确认ComfyUI服务正在运行（默认端口8188），检查 `.env` 中的配置是否正确

- **Q: 数据库连接错误？**  
  A: 确认PostgreSQL服务正在运行，数据库 `ai-draw` 已创建，`.env` 中的连接信息正确

- **Q: 前端无法连接后端？**  
  A: 确认后端服务运行在 http://localhost:8000，前端 Vite 代理配置正确

- **Q: AI Prompt生成失败？**  
  A: 检查 `.env` 中的 `AI_PROMPT_API_KEY` 是否有效，API额度是否充足

### 使用问题
- **Q: 配置不保存？**  
  A: 未登录时配置仅保存在浏览器本地，需要注册/登录账户才能持久化

- **Q: 聊天历史丢失？**  
  A: 游客模式下刷新页面会清空历史，登录后历史会自动保存到数据库

- **Q: 生成图片失败？**  
  A: 检查ComfyUI工作流配置文件是否正确，模型文件是否存在，LoRA路径是否有效

- **Q: Token过期怎么办？**  
  A: Token有效期7天，过期后自动清除，需要重新登录

### 开发问题
- **Q: 如何添加新的工作流？**  
  A: 在ComfyUI中设计工作流，导出API JSON，放入 `configs/workflows/`，在 `comfyui_service.py` 中注册

- **Q: 如何修改Token有效期？**  
  A: 编辑 `server/auth.py` 中的 `ACCESS_TOKEN_EXPIRE_MINUTES` 常量

- **Q: 如何自定义AI Prompt模板？**  
  A: 编辑 `configs/app_config.yaml` 中的 `ai_prompt.system_prompt` 配置

## 架构设计

### 后端架构
```
FastAPI Application
  ├── Lifespan (启动/关闭)
  │   ├── 数据库初始化
  │   ├── AIDrawService单例创建
  │   └── ComfyUI连接检测
  │
  ├── REST API
  │   ├── /api/service/*      - 服务管理
  │   ├── /api/image/*        - 图像生成
  │   ├── /api/workflow/*     - 工作流管理
  │   ├── /api/prompt/*       - Prompt生成
  │   ├── /api/auth/*         - 用户认证
  │   ├── /api/config/*       - 用户配置
  │   └── /api/chat/*         - 聊天历史
  │
  ├── WebSocket (/ws)
  │   └── 实时状态推送
  │
  ├── Middleware (中间件)
  │   └── error_handler.py   - 统一错误处理
  │
  └── Database (PostgreSQL)
      ├── users              - 用户表
      ├── user_configs       - 配置表
      ├── chat_messages      - 消息表
      ├── generated_images   - 图片表
      └── reference_images   - 参考图表
```

### 前端架构
```
React Application
  ├── App.tsx (主应用)
  │   ├── ErrorBoundary    - 错误边界
  │   ├── 主题检测（深色/浅色）
  │   ├── 用户数据加载
  │   ├── WebSocket连接
  │   └── 服务状态监控
  │
  ├── Components (组件)
  │   ├── StatusBar        - 状态栏（登录入口）
  │   ├── LoginModal       - 登录/注册弹窗
  │   ├── ChatInput        - 聊天输入框
  │   ├── ResultGrid       - 结果展示
  │   ├── ParametersPanel  - 参数面板
  │   └── ...
  │
  ├── Stores (Zustand)
  │   └── appStore         - 全局状态管理
  │       ├── 用户配置状态
  │       ├── 聊天历史
  │       ├── 服务状态
  │       └── 自动保存逻辑
  │
  └── API Layer
      ├── client.ts        - Axios配置（Token拦截、错误处理）
      ├── services.ts      - REST API封装
      └── websocket.ts     - WebSocket管理器
```

## 统一错误处理

### 后端错误处理

#### 自定义异常类型

| 异常类 | HTTP 状态码 | 错误码 | 用途 |
|--------|------------|--------|------|
| `AuthenticationError` | 401 | `AUTHENTICATION_ERROR` | 认证失败 |
| `AuthorizationError` | 403 | `AUTHORIZATION_ERROR` | 权限不足 |
| `ResourceNotFoundError` | 404 | `RESOURCE_NOT_FOUND` | 资源不存在 |
| `ValidationError` | 422 | `VALIDATION_ERROR` | 数据验证失败 |
| `DatabaseError` | 500 | `DATABASE_ERROR` | 数据库操作失败 |
| `ExternalServiceError` | 503 | `EXTERNAL_SERVICE_ERROR` | 外部服务错误 |

#### 统一错误响应格式

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {}
  }
}
```

#### 使用示例

```python
from server.middleware import AuthenticationError, ResourceNotFoundError

# 认证失败
if not user:
    raise AuthenticationError("用户名或密码错误")

# 资源不存在
if not image:
    raise ResourceNotFoundError("图片不存在", details={"image_id": image_id})
```

### 前端错误处理

#### React 错误边界

- ✅ 捕获组件树中的 JavaScript 错误
- ✅ 显示友好的降级 UI
- ✅ 开发环境显示详细错误堆栈
- ✅ 提供"重试"和"刷新页面"按钮

#### API 错误自动处理

前端 Axios 拦截器自动处理所有 API 错误：

- 解析后端标准错误格式
- 根据错误码分类处理（认证、权限、验证等）
- 自动显示 Ant Design 错误提示
- 无需在业务代码中手动处理错误提示

```typescript
// 业务代码无需处理错误提示
try {
  const result = await apiService.generateImage(params);
  // 成功处理
} catch (error) {
  // 错误已自动提示
  console.error('操作失败:', error);
}
```

### 错误处理流程

```
后端: 业务逻辑 → 抛出异常 → 异常处理器 → 标准错误响应 → 记录日志
前端: API请求 → 响应拦截器 → 解析错误 → 自动提示 → 业务处理
React: 组件错误 → ErrorBoundary → 降级UI → 用户操作
```

## Docker 部署详细指南

### 快速开始

#### 开发环境

```bash
# 启动所有服务（开发模式 - 支持热重载）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重新构建镜像
docker-compose up -d --build
```

#### 生产环境

```bash
# 启动生产环境
docker-compose -f docker-compose.prod.yml up -d

# 查看运行状态
docker-compose -f docker-compose.prod.yml ps

# 查看日志
docker-compose -f docker-compose.prod.yml logs -f ai-draw-backend

# 停止服务
docker-compose -f docker-compose.prod.yml down
```

### 环境变量配置

在项目根目录创建 `.env` 文件：

```env
# 服务器配置
SERVER_PORT=8000

# 数据库配置
DB_USER=ai_draw
DB_PASSWORD=your_secure_password
DB_NAME=ai_draw
DB_PORT=5432

# Redis 配置（生产环境）
REDIS_PASSWORD=your_redis_password

# AI Prompt API
AI_PROMPT_API_KEY=your_api_key
AI_PROMPT_BASE_URL=https://api.deepseek.com

# ComfyUI 配置
COMFYUI_URL=http://host.docker.internal:8188
COMFYUI_PATH=/path/to/comfyui
COMFYUI_PYTHON=/path/to/python

# JWT Secret
JWT_SECRET_KEY=your_jwt_secret_key
```

### 常用命令

#### 容器管理

```bash
# 进入后端容器
docker exec -it ai-draw-backend bash

# 进入数据库容器
docker exec -it ai-draw-postgres psql -U ai_draw -d ai_draw

# 查看容器资源使用
docker stats

# 清理未使用的资源
docker system prune -a
```

#### 数据库操作

```bash
# 数据库备份
docker exec ai-draw-postgres pg_dump -U ai_draw ai_draw > backup_$(date +%Y%m%d).sql

# 数据库恢复
docker exec -i ai-draw-postgres psql -U ai_draw ai_draw < backup.sql

# 运行数据库迁移
docker exec ai-draw-backend alembic upgrade head
```

#### 日志管理

```bash
# 实时查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f ai-draw-backend

# 查看最近 100 行日志
docker-compose logs --tail=100 ai-draw-backend

# 保存日志到文件
docker-compose logs > logs_$(date +%Y%m%d).txt
```

### 镜像优化

#### 构建优化镜像

```bash
# 构建不带缓存
docker-compose build --no-cache

# 查看镜像大小
docker images | grep ai-draw

# 清理悬空镜像
docker image prune -f
```

#### 多平台构建（可选）

```bash
# 创建 buildx 构建器
docker buildx create --name ai-draw-builder --use

# 构建多平台镜像
docker buildx build --platform linux/amd64,linux/arm64 -t ai-draw:latest .
```

### 网络配置

#### 外部访问 ComfyUI

如果 ComfyUI 运行在宿主机上，容器需要访问：

**Windows/Mac**:
```env
COMFYUI_URL=http://host.docker.internal:8188
```

**Linux**:
```bash
# 使用宿主机 IP
COMFYUI_URL=http://172.17.0.1:8188

# 或者使用 --network host 模式
docker run --network host ...
```

#### 自定义网络

```bash
# 创建网络
docker network create ai-draw-custom

# 连接容器到网络
docker network connect ai-draw-custom ai-draw-backend
```

### 故障排查

#### 健康检查失败

```bash
# 检查服务状态
docker-compose ps

# 查看健康检查日志
docker inspect --format='{{json .State.Health}}' ai-draw-backend | jq

# 手动执行健康检查
docker exec ai-draw-backend curl -f http://localhost:8000/api/service/status
```

#### 容器无法启动

```bash
# 查看详细错误信息
docker-compose logs ai-draw-backend

# 检查配置文件语法
docker-compose config

# 交互式运行容器调试
docker run -it --rm ai-draw bash
```

#### 数据库连接问题

```bash
# 测试数据库连接
docker exec ai-draw-backend python -c "from server.database import engine; print(engine.connect())"

# 检查数据库是否就绪
docker exec ai-draw-postgres pg_isready -U ai_draw
```

### 性能优化

#### 生产环境建议

1. **资源限制**: 在 `docker-compose.prod.yml` 中配置 CPU 和内存限制
2. **Worker 数量**: 根据 CPU 核心数调整 uvicorn workers（建议 2 * CPU + 1）
3. **数据库连接池**: 在 `app_config.yaml` 中优化数据库连接池大小
4. **日志轮转**: 配置 Docker 日志驱动
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

#### 监控和指标

```bash
# 实时监控容器资源
docker stats

# 查看容器进程
docker top ai-draw-backend

# 导出 Prometheus 指标（需要配置）
curl http://localhost:8000/metrics
```

### 更新和部署

#### 滚动更新

```bash
# 拉取最新代码
git pull

# 重新构建并启动（零停机）
docker-compose up -d --build --no-deps ai-draw-backend

# 验证新版本
curl http://localhost:8000/api/service/status
```

#### 备份和恢复

```bash
# 备份数据卷
docker run --rm -v ai-draw_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_data_backup.tar.gz -C /data .

# 恢复数据卷
docker run --rm -v ai-draw_postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/postgres_data_backup.tar.gz -C /data
```

### 安全建议

1. ✅ **使用非 root 用户运行容器**（已在 Dockerfile 中配置）
2. ✅ **健康检查**（已配置）
3. ✅ **资源限制**（生产环境配置）
4. ⚠️ **定期更新基础镜像**
5. ⚠️ **使用密钥管理工具**（如 Docker Secrets）
6. ⚠️ **启用 TLS/SSL**（配置 Nginx）
7. ⚠️ **限制容器能力**（使用 --cap-drop）

### Docker 配置优化说明

#### Dockerfile 优化

- ✅ 多阶段构建减少最终镜像大小（~200MB）
- ✅ 使用 .dockerignore 减少构建上下文
- ✅ 合并 RUN 命令减少层数
- ✅ 使用特定版本标签而非 latest
- ✅ 清理 apt 缓存
- ✅ 非 root 用户运行

#### docker-compose.yml 优化

- ✅ 健康检查配置
- ✅ 重启策略
- ✅ 环境变量管理
- ✅ 网络隔离
- ✅ 数据卷持久化
- ✅ 服务依赖管理

## 开发路线图与优化计划

### 🎯 v1.1 重构完成 ✅

**状态**: 已完成

- ✅ 后端模块化架构（API 拆分为独立模块）
- ✅ 前端工具函数和常量提取
- ✅ 用户认证和数据持久化
- ✅ 聊天历史和参考图保存
- ✅ 统一错误处理
- ✅ 完善类型定义
- ✅ TypeScript 编译错误修复
- ✅ CSS 语法错误修复

### 🚀 v1.2 性能优化（进行中）

**高优先级**

- [ ] **数据库优化**
  - [ ] 为常用查询字段添加索引
    - `chat_messages.user_id`
    - `chat_messages.created_at`
    - `generated_images.message_id`
  - [ ] 优化 `get_chat_history` 查询（使用 `joinedload`）
  - [ ] 添加数据库迁移脚本（Alembic）

- [ ] **前端性能优化**
  - [ ] `ResultGrid` 使用 `React.memo`
  - [ ] `ChatInput` 使用 `useMemo` 缓存复杂计算
  - [ ] 图片懒加载（Intersection Observer）

- [ ] **后端异步优化**
  - [ ] 图像生成使用后台任务队列（Celery/RQ）
  - [ ] Prompt 生成使用后台任务

**中优先级**

- [ ] **日志系统**
  - [ ] 配置 `logging` 模块
  - [ ] 统一日志格式
  - [ ] 日志级别配置（DEBUG/INFO/WARNING/ERROR）
  - [ ] 日志文件轮转

- [ ] **代码清理**
  - [ ] 删除向后兼容代码
  - [ ] 删除未使用的导入和变量
  - [ ] 统一代码风格（Prettier + ESLint）

### 📦 v1.3 功能增强

- [ ] **图片历史记录**
  - [ ] 分页加载
  - [ ] 搜索过滤
  - [ ] 标签分类

- [ ] **用户设置**
  - [ ] 主题切换（亮/暗）
  - [ ] 语言切换（中/英）
  - [ ] 快捷键配置

- [ ] **协作功能**
  - [ ] 分享生成的图片
  - [ ] 公开图库
  - [ ] 点赞收藏

### 🔬 测试与文档

**测试**

- [ ] **后端单元测试**
  - [ ] `test_user_api.py` - 用户认证 API
  - [ ] `test_image_api.py` - 图像生成 API
  - [ ] `test_database.py` - 数据库操作

- [ ] **前端单元测试**
  - [ ] `helpers.test.ts` - 工具函数测试
  - [ ] `appStore.test.ts` - Store 测试

- [ ] **E2E 测试** (Playwright)
  - [ ] 用户注册登录流程
  - [ ] 图像生成流程

**文档**

- [ ] API 文档补充（添加更多示例）
- [ ] 组件文档（Storybook）
- [ ] 贡献指南

### 🐛 已知问题

**Bug 修复**

- [x] ~~参考图刷新后丢失~~ (已修复)
- [x] ~~聊天历史不持久化~~ (已修复)
- [ ] WebSocket 断线重连可能导致消息丢失
- [ ] 大图片上传可能超时（需要进度条）
- [ ] 游客模式 localStorage 可能超出配额

**兼容性**

- [ ] 测试 Safari 浏览器兼容性
- [ ] 测试移动端响应式布局
- [ ] 测试低分辨率屏幕显示

### 📊 性能指标目标

- [ ] API 响应时间 < 200ms (P95)
- [ ] 图像生成时间 < 10s (单张)
- [ ] 首屏加载时间 < 2s
- [ ] 包体积 < 500KB (gzipped)

### 🔮 v2.0 商业化

- [ ] 多租户支持
- [ ] 付费功能（高级模型、更快速度）
- [ ] 管理后台
- [ ] 性能监控（Prometheus + Grafana）
- [ ] 错误追踪（Sentry）
- [ ] 用户行为分析（Google Analytics）

---

**最后更新**: 2025-12-17  
**维护者**: GitHub Copilot

## 反馈与贡献

欢迎提交 issue 或 PR 参与改进！

📧 联系方式: [GitHub Issues](https://github.com/nekocon233/AIDraw/issues)

---

> 🎨 让 AI 成为你的创作助手，释放更多灵感！
