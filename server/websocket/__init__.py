"""
WebSocket 路由

提供实时双向通信，推送状态更新和生成进度
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import asyncio
import json

from server.ai_draw_service import get_ai_draw_service

router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器"""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"[WebSocket] 客户端已连接，当前连接数: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"[WebSocket] 客户端已断开，当前连接数: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict):
        """广播消息到所有连接的客户端"""
        if not self.active_connections:
            return
        
        message_str = json.dumps(message, ensure_ascii=False)
        disconnected = set()
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_str)
            except Exception as e:
                print(f"[WebSocket] 发送消息失败: {e}")
                disconnected.add(connection)
        
        # 移除断开的连接
        for conn in disconnected:
            self.active_connections.discard(conn)


# 全局连接管理器
manager = ConnectionManager()


def setup_service_callbacks():
    """设置服务状态变化回调"""
    service = get_ai_draw_service()
    
    def on_state_change(field: str, value):
        """状态变化时通过 WebSocket 广播"""
        asyncio.create_task(manager.broadcast({
            "type": "state_change",
            "field": field,
            "value": value
        }))
    
    service.on_state_change = on_state_change


# 初始化标志
_callbacks_initialized = False


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 连接端点"""
    global _callbacks_initialized
    
    # 首次连接时设置回调
    if not _callbacks_initialized:
        setup_service_callbacks()
        _callbacks_initialized = True
    
    await manager.connect(websocket)
    service = get_ai_draw_service()
    
    try:
        # 发送初始状态
        initial_state = {
            "type": "initial_state",
            "data": {
                "is_generating": service.is_generating,
                "is_generating_prompt": service.is_generating_prompt,
                "is_service_available": service.is_service_available,
                "preview_images": service.preview_images,
            }
        }
        await websocket.send_json(initial_state)
        
        # 保持连接并接收客户端消息
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # 处理心跳
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[WebSocket] 连接异常: {e}")
        manager.disconnect(websocket)
