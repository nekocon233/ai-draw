"""
WebSocket 路由

提供实时双向通信，推送状态更新和生成进度
"""
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import asyncio
import json

from server.ai_draw_service import get_ai_draw_service
from server.auth import get_user_from_token
from server.database import SessionLocal

router = APIRouter()

MEDIA_TASK_FIELDS = {
    'is_generating',
    'generation_progress',
    'media_generated',
    'preview_update',
    'error',
}


class ConnectionManager:
    """WebSocket 连接管理器"""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        # 存储每个连接的会话ID（浏览器连接 ID，非数据库会话 ID）
        self.connection_sessions: dict[WebSocket, str] = {}
        # 存储每个连接归属的数据库 user_id（用于按用户过滤 initial_state 中的 last_task）
        self.connection_users: dict[WebSocket, int] = {}
    
    async def connect(self, websocket: WebSocket, session_id: str = None, user_id: int = None):
        await websocket.accept()
        self.active_connections.add(websocket)
        if session_id:
            self.connection_sessions[websocket] = session_id
        if user_id is not None:
            self.connection_users[websocket] = user_id
        print(f"[WebSocket] 客户端已连接，会话ID: {session_id}，当前连接数: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.connection_sessions.pop(websocket, None)
        self.connection_users.pop(websocket, None)
        print(f"[WebSocket] 客户端已断开，当前连接数: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict, session_id: str = None, user_id: int = None):
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
            if user_id is not None and self.connection_users.get(connection) != user_id:
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
            self.connection_users.pop(conn, None)


# 全局连接管理器
manager = ConnectionManager()


def setup_service_callbacks():
    """设置服务状态变化回调"""
    service = get_ai_draw_service()
    
    def on_state_change(field: str, value, user_id: int | None):
        """生成事件只推送给任务所属用户，公共服务状态仍广播。"""
        payload = {
            "type": "state_change",
            "field": field,
            "value": value
        }
        if field in MEDIA_TASK_FIELDS and user_id == service.current_user_id:
            payload["message_id"] = service.current_message_id
            payload["session_id"] = service.current_session_id
            payload["task_id"] = service.current_task_id
        asyncio.create_task(manager.broadcast(payload, user_id=user_id))
    
    service.on_state_change = on_state_change


# 初始化标志
_callbacks_initialized = False


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 连接端点"""
    global _callbacks_initialized

    token = websocket.query_params.get("token")
    db = SessionLocal()
    try:
        user = get_user_from_token(token or "", db)
    finally:
        db.close()
    if user is None:
        await websocket.accept()
        await websocket.close(code=1008, reason="Authentication required")
        return
    
    # 首次连接时设置回调
    if not _callbacks_initialized:
        setup_service_callbacks()
        _callbacks_initialized = True
    
    session_id = None
    service = get_ai_draw_service()
    
    try:
        await manager.connect(websocket, user_id=user.id)
        
        # 等待客户端发送会话ID
        data = await websocket.receive_text()
        message = json.loads(data)
        
        if message.get("type") == "init":
            session_id = message.get("session_id")
            if session_id:
                manager.connection_sessions[websocket] = session_id
                print(f"[WebSocket] 会话ID已设置: {session_id}")
        
        # 按用户过滤 last_task，避免向其他用户泄漏
        lt = service.get_last_task(user.id)
        last_task_payload = None
        if lt and lt.get('user_id') == user.id:
            status = lt.get('status')
            finished_at = lt.get('finished_at')
            if status == 'running':
                last_task_payload = dict(lt)
            elif finished_at and time.time() - finished_at < 1800:
                last_task_payload = dict(lt)

        # 发送初始状态
        owns_active_task = service.current_user_id == user.id
        initial_state = {
            "type": "initial_state",
            "data": {
                "is_generating": service.is_generating and owns_active_task,
                "is_generating_prompt": service.is_generating_prompt,
                "is_service_available": service.is_service_available,
                "preview_items": service.preview_items if owns_active_task else [],
                "last_task": last_task_payload,
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
