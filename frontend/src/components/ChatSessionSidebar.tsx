import { useState } from 'react';
import { Button, Input, Popconfirm, Tooltip } from 'antd';
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
    switchSession, 
    deleteSession, 
    updateSessionTitle,
    isSidebarCollapsed,
    toggleSidebar
  } = useAppStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleCreateSession = () => {
    createSession();
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const startEditTitle = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const saveTitle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingId && editTitle.trim()) {
      updateSessionTitle(editingId, editTitle.trim());
      setEditingId(null);
    }
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  return (
    <div className={`sidebar-container ${isSidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!isSidebarCollapsed && (
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={handleCreateSession}
            block
            style={{ marginRight: 8 }}
          >
            新对话
          </Button>
        )}
        <Button
          type="text"
          icon={isSidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        />
      </div>

      <div className="session-list">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
            onClick={() => switchSession(session.id)}
          >
            <div className="session-icon">
              <MessageOutlined />
            </div>
            
            {!isSidebarCollapsed && (
              <div className="session-content">
                {editingId === session.id ? (
                  <div className="session-edit" onClick={e => e.stopPropagation()}>
                    <Input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onPressEnter={saveTitle as any}
                      size="small"
                      autoFocus
                    />
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
                ) : (
                  <>
                    <span className="session-title" title={session.title}>
                      {session.title}
                    </span>
                    <div className="session-actions">
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
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
