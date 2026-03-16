import { useState } from 'react';
import { Button, List, Input, Popconfirm, Tooltip } from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import type { ChatSession } from '../types/models';
import './ChatSessionSidebar.css';

export default function ChatSessionSidebar() {
  const {
    sessions,
    currentSessionId,
    createSession,
    deleteSession,
    switchSession,
    updateSessionTitle,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore();
  
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleCreateSession = async () => {
    await createSession();
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(sessionId);
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId !== currentSessionId) {
      switchSession(sessionId);
    }
  };

  const startEditTitle = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const saveTitle = async () => {
    if (editingSessionId && editingTitle.trim()) {
      await updateSessionTitle(editingSessionId, editingTitle.trim());
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const cancelEdit = () => {
    setEditingSessionId(null);
    setEditingTitle('');
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

  return (
    <div className={`chat-session-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!sidebarCollapsed && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreateSession}
            size="small"
          >
            新对话
          </Button>
        )}
        <Button
          className="collapse-btn"
          type="text"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        />
      </div>

      <div className="session-list">
        <List
          dataSource={sessions.sort((a, b) => b.updated_at - a.updated_at)}
          renderItem={(session) => (
            <List.Item
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => handleSwitchSession(session.id)}
            >
              <div className="session-content">
                <div className="session-header">
                  <MessageOutlined className="session-icon" />
                  {editingSessionId === session.id ? (
                    <div className="session-title-edit" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onPressEnter={saveTitle}
                        size="small"
                        autoFocus
                      />
                      <div className="edit-actions">
                        <Button
                          type="text"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={saveTitle}
                        />
                        <Button
                          type="text"
                          size="small"
                          icon={<CloseOutlined />}
                          onClick={cancelEdit}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="session-title">{session.title}</span>
                  )}
                </div>
                <div className="session-meta">
                  <span className="session-time">{formatDate(session.updated_at)}</span>
                  <span className="session-count">{session.message_count} 条消息</span>
                </div>
              </div>
              <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                {editingSessionId !== session.id && (
                  <>
                    <Tooltip title="重命名">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => startEditTitle(session, e)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定删除这个对话吗？"
                      description="删除后无法恢复"
                      onConfirm={(e) => handleDeleteSession(session.id, e!)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                        />
                      </Tooltip>
                    </Popconfirm>
                  </>
                )}
              </div>
            </List.Item>
          )}
        />
      </div>
    </div>
  );
}
