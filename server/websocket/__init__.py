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
        # 存储每个连接的会话ID（可以是用户ID或临时会话ID）
        self.connection_sessions: dict[WebSocket, str] = {}
    
    async def connect(self, websocket: WebSocket, session_id: str = None):
        await websocket.accept()
        self.active_connections.add(websocket)
        if session_id:
            self.connection_sessions[websocket] = session_id
        print(f"[WebSocket] 客户端已连接，会话ID: {session_id}，当前连接数: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.connection_sessions.pop(websocket, None)
        print(f"[WebSocket] 客户端已断开，当前连接数: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict, session_id: str = None):
        """
        广播消息到客户端
        如果指定 session_id，只发送给该会话；否则广播给所有客户端
        """
        if not self.active_connections:
            return
        
        message_str = json.dumps(message, ensure_ascii=False)
        disconnected = set()
        
        for connection in self.active_connections:
            # 如果指定了会话ID，只发送给匹配的连接
            if session_id and self.connection_sessions.get(connection) != session_id:
                continue
                
            try:
                await connection.send_text(message_str)
            except Exception as e:
                print(f"[WebSocket] 发送消息失败: {e}")
                disconnected.add(connection)
        
        # 移除断开的连接
        for conn in disconnected:
            self.active_connections.discard(conn)
            self.connection_sessions.pop(conn, None)


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
    
    session_id = None
    service = get_ai_draw_service()
    
    try:
        await manager.connect(websocket)
        
        # 等待客户端发送会话ID
        data = await websocket.receive_text()
        message = json.loads(data)
        
        if message.get("type") == "init":
            session_id = message.get("session_id")
            if session_id:
                manager.connection_sessions[websocket] = session_id
                print(f"[WebSocket] 会话ID已设置: {session_id}")
        
        # 发送初始状态
        initial_state = {
            "type": "initial_state",
            "data": {
                "is_generating": service.is_generating,
                "is_generating_prompt": service.is_generating_prompt,
                "is_service_available": service.is_service_available,
                "preview_items": service.preview_items,
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
