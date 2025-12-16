/**
 * WebSocket 管理器
 */
import type { WSMessage } from '../types/api';

type MessageHandler = (data: WSMessage) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8000/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket 连接成功');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handlers.forEach(handler => handler(data));
        } catch (error) {
          console.error('解析 WebSocket 消息失败:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket 连接关闭');
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('WebSocket 连接失败:', error);
      this.scheduleReconnect();
    }
  }

  subscribe(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket 未连接,无法发送消息');
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('WebSocket 重连次数已达上限');
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    
    console.log(`${delay}ms 后尝试重连 WebSocket (第 ${this.reconnectAttempts} 次)...`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsManager = new WebSocketManager();
