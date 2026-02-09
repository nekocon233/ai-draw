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
  private sessionId: string;

  constructor() {
    // 从 localStorage 获取或生成会话ID
    let sessionId = localStorage.getItem('ws_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('ws_session_id', sessionId);
    }
    this.sessionId = sessionId;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const envBackendUrl = (import.meta as any)?.env?.VITE_BACKEND_URL as string | undefined;

    let wsUrl: string;
    if (envBackendUrl) {
      const normalized = envBackendUrl.replace(/\/+$/, '');
      wsUrl = `${normalized.replace(/^http/, 'ws')}/ws`;
    } else if (window.location.port === '5173') {
      wsUrl = `${protocol}//${window.location.hostname}:14600/ws`;
    } else {
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket 连接成功，会话ID:', this.sessionId);
        this.reconnectAttempts = 0;
        // 发送会话ID到服务器
        this.send({ type: 'init', session_id: this.sessionId });
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
        console.warn('WebSocket 错误:', error);
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
