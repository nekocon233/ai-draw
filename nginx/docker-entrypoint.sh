#!/bin/sh
# Nginx 配置环境变量替换脚本

set -e

echo "替换 Nginx 配置中的环境变量..."
echo "BACKEND_PORT=${BACKEND_PORT}"

# 使用 envsubst 替换环境变量
envsubst '${BACKEND_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "Nginx 配置已生成"
cat /etc/nginx/nginx.conf | grep "server ai-draw-backend"

# 启动 Nginx
exec nginx -g 'daemon off;'
