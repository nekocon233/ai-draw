# AI-Draw 多阶段构建 Dockerfile
# Stage 1: 前端构建
# Stage 2: 后端依赖安装
# Stage 3: 最终运行镜像

# ============================================
# Stage 1: 前端构建阶段
# ============================================
FROM node:18-alpine as frontend-builder

WORKDIR /frontend

# 复制前端依赖配置
COPY frontend/package*.json ./

# 安装依赖
RUN npm ci --only=production=false

# 复制前端源码
COPY frontend/ ./

# 构建前端
RUN npm run build

# ============================================
# Stage 2: 后端依赖构建阶段
# ============================================
FROM python:3.10-slim as backend-builder

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 安装构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制并安装 Python 依赖
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# ============================================
# Stage 3: 最终运行阶段
# ============================================
FROM python:3.10-slim

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/root/.local/bin:$PATH

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 从后端构建阶段复制 Python 包
COPY --from=backend-builder /root/.local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=backend-builder /root/.local/bin /usr/local/bin

# 从前端构建阶段复制构建产物
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

# 复制后端应用代码
COPY server/ ./server/
COPY comfyui/ ./comfyui/
COPY utils/ ./utils/
COPY configs/ ./configs/
COPY run.py .

# 创建 uploads 目录
RUN mkdir -p /app/uploads

# 启动命令 - 使用 run.py 从配置读取端口
CMD ["python", "run.py"]
