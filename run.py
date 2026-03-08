"""
AI-Draw 启动脚本

快速启动开发服务器
"""
import uvicorn
from utils.config_loader import load_config

if __name__ == "__main__":
    # 加载配置
    config = load_config()
    server_config = config.server
    
    print("=" * 60)
    print(f"🚀 AI-Draw v{config.app.version}")
    print("=" * 60)
    print(f"📡 服务地址: http://{server_config.host}:{server_config.port}")
    print(f"📚 API 文档: http://localhost:{server_config.port}/docs")
    print(f"🔌 WebSocket: ws://localhost:{server_config.port}/ws")
    print("=" * 60)
    print()
    
    # 启动服务
    uvicorn.run(
        "server.main:app",
        host=server_config.host,
        port=server_config.port,
        reload=server_config.reload,
        log_level="info",
        timeout_keep_alive=3600,  # 保持连接 60 分钟
        timeout_graceful_shutdown=30,  # 优雅关闭超时 30 秒
    )
