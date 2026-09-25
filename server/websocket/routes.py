"""Authenticated WebSocket transport; event identity is supplied by the application."""
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.ai_draw_service import get_ai_draw_service
from server.auth import get_user_from_token
from server.database import SessionLocal
from .manager import ConnectionManager

router = APIRouter()
manager = ConnectionManager()


def setup_service_callbacks(service):
    pending = set()

    def on_state_change(event):
        task = asyncio.create_task(manager.publish(event))
        pending.add(task)
        task.add_done_callback(pending.discard)

    return service.events.subscribe(on_state_change)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 连接端点"""

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
        
        await websocket.send_json({
            "type": "initial_state",
            "data": service.initial_state(user.id),
        })

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
