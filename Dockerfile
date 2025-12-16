# AI-Draw Backend Dockerfile
# 多阶段构建优化镜像大小

# ============================================
# Stage 1: 构建阶段 - 安装依赖
# ============================================
FROM python:3.10-slim as builder

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
# Stage 2: 运行阶段 - 最小化镜像
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

# 从构建阶段复制 Python 包
COPY --from=builder /root/.local /root/.local

# 复制应用代码
COPY server/ ./server/
COPY comfyui/ ./comfyui/
COPY utils/ ./utils/
COPY configs/ ./configs/
COPY run.py .

# 创建非 root 用户运行应用（安全性最佳实践）
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/service/status || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令 - 使用 uvicorn 直接启动以支持生产环境
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
