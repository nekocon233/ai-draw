import { useState } from 'react';
import { Button, List, Popconfirm, Tooltip } from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import type { ChatSession } from '../types/models';
import { AccountMenu } from './StatusBar';
import './ChatSessionSidebar.css';

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`sidebar-control-icon ${collapsed ? 'is-collapsed' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect className="sidebar-control-shell" x="3.25" y="4.25" width="17.5" height="15.5" rx="3" />
      <path className="sidebar-control-rail" d="M9 4.75v14.5" />
      <path className="sidebar-control-arrow" d="m16 9-3 3 3 3" />
    </svg>
  );
}

export default function ChatSessionSidebar() {
  const {
    sessions,
    currentSessionId,
    createSession,
    deleteSession,
    switchSession,
    setSessionPinned,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore();
  
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isMobile = () => window.innerWidth <= 768;

  const handleCreateSession = async () => {
    await createSession();
    if (isMobile()) setIsMobileOpen(false);
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(sessionId);
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId !== currentSessionId) {
      switchSession(sessionId);
    }
    if (isMobile()) setIsMobileOpen(false);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    
    if (days === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
  };

  const pinnedSessions = sessions.filter(session => session.is_pinned).sort((a, b) => b.updated_at - a.updated_at);
  const recentSessions = sessions.filter(session => !session.is_pinned).sort((a, b) => b.updated_at - a.updated_at);

  const renderSession = (session: ChatSession) => (
    <List.Item
      key={session.id}
      className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
    >
      <button
        type="button"
        className="session-select"
        onClick={() => handleSwitchSession(session.id)}
        aria-current={session.id === currentSessionId ? 'page' : undefined}
      >
        <MessageOutlined className="session-icon" />
        <span className="session-copy">
          <span className="session-title">{session.title}</span>
          <span className="session-meta">
            <span>{formatDate(session.updated_at)}</span>
            <span>{session.message_count} 条</span>
          </span>
        </span>
      </button>

      <div className="session-actions">
        <Tooltip title={session.is_pinned ? '取消置顶' : '置顶'}>
          <Button
            type="text"
            size="small"
            className={session.is_pinned ? 'is-pinned' : ''}
            icon={session.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setSessionPinned(session.id, !session.is_pinned);
            }}
            aria-label={`${session.is_pinned ? '取消置顶' : '置顶'} ${session.title}`}
          />
        </Tooltip>
        <Popconfirm
          title="确定删除这个对话吗？"
          description="删除后无法恢复"
          onConfirm={(event) => handleDeleteSession(session.id, event!)}
          okText="删除"
          cancelText="取消"
        >
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${session.title}`} />
          </Tooltip>
        </Popconfirm>
      </div>
    </List.Item>
  );

  return (
    <>
      <button
        className={`sidebar-overlay ${isMobileOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="关闭会话列表"
        aria-hidden={!isMobileOpen}
        tabIndex={isMobileOpen ? 0 : -1}
        onClick={() => setIsMobileOpen(false)}
      />

      {!isMobileOpen && (
        <button
          className="sidebar-mobile-toggle"
          type="button"
          onClick={() => setIsMobileOpen(true)}
          aria-label="打开会话列表"
          aria-expanded={false}
          aria-controls="chat-session-sidebar"
        >
          <SidebarToggleIcon collapsed />
        </button>
      )}

      <aside
        id="chat-session-sidebar"
        className={`chat-session-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
        aria-label="会话导航"
      >
        <header className="sidebar-header">
          <div className="sidebar-brand-row">
            <span className="sidebar-brand-lockup">
              <img src="/ai-draw.svg" alt="" aria-hidden="true" />
              <span className="sidebar-brand">ai-draw</span>
            </span>
            <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}>
              <Button
                className="collapse-btn"
                type="text"
                icon={<SidebarToggleIcon collapsed={sidebarCollapsed && !isMobileOpen} />}
                onClick={() => {
                  if (isMobile()) {
                    setIsMobileOpen(false);
                  } else {
                    setSidebarCollapsed(!sidebarCollapsed);
                  }
                }}
                aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              />
            </Tooltip>
          </div>

          <Tooltip title={sidebarCollapsed && !isMobileOpen ? '新对话' : undefined} placement="right">
            <Button
              className="new-chat-button"
              type="text"
              icon={<PlusOutlined />}
              onClick={handleCreateSession}
              aria-label={sidebarCollapsed && !isMobileOpen ? '新对话' : undefined}
            >
              <span className="new-chat-label">新对话</span>
            </Button>
          </Tooltip>
        </header>

        <nav className="session-list" aria-label="最近会话">
          {sessions.length > 0 ? (
            <>
              {pinnedSessions.length > 0 && (
                <section className="session-group" aria-labelledby="pinned-sessions-label">
                  <div id="pinned-sessions-label" className="session-list-label">置顶</div>
                  <List dataSource={pinnedSessions} renderItem={renderSession} />
                </section>
              )}
              {recentSessions.length > 0 && (
                <section className="session-group" aria-labelledby="recent-sessions-label">
                  <div id="recent-sessions-label" className="session-list-label">最近</div>
                  <List dataSource={recentSessions} renderItem={renderSession} />
                </section>
              )}
            </>
          ) : (
            <div className="session-empty">
              <MessageOutlined />
              <span>还没有对话</span>
            </div>
          )}
        </nav>

        <footer className="sidebar-footer">
          <AccountMenu collapsed={sidebarCollapsed && !isMobileOpen} />
        </footer>
      </aside>
    </>
  );
}
