import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Dropdown, Input, List, Modal, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  PushpinFilled,
  PushpinOutlined,
  EllipsisOutlined,
  FolderAddOutlined,
  FolderOutlined,
  RightOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChatSession, ChatSessionGroup } from '../types/models';
import { buildSessionSections, type SessionSection } from '../utils/sessionGroups';
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
    sessionGroups,
    ungroupedCollapsed,
    sessionNavigationPending,
    sessionNavigationLoading,
    sessionNavigationError,
    refreshSessionNavigation,
    clearSessionNavigationError,
    createSessionGroup,
    updateSessionGroup,
    deleteSessionGroup,
    moveSessionToGroup,
    setUngroupedCollapsed,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore(useShallow(state => ({
    sessions: state.sessions,
    currentSessionId: state.currentSessionId,
    createSession: state.createSession,
    deleteSession: state.deleteSession,
    switchSession: state.switchSession,
    setSessionPinned: state.setSessionPinned,
    sessionGroups: state.sessionGroups,
    ungroupedCollapsed: state.ungroupedCollapsed,
    sessionNavigationPending: state.sessionNavigationPending,
    sessionNavigationLoading: state.sessionNavigationLoading,
    sessionNavigationError: state.sessionNavigationError,
    refreshSessionNavigation: state.refreshSessionNavigation,
    clearSessionNavigationError: state.clearSessionNavigationError,
    createSessionGroup: state.createSessionGroup,
    updateSessionGroup: state.updateSessionGroup,
    deleteSessionGroup: state.deleteSessionGroup,
    moveSessionToGroup: state.moveSessionToGroup,
    setUngroupedCollapsed: state.setUngroupedCollapsed,
    sidebarCollapsed: state.sidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
  })));
  
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { modal } = App.useApp();
  const [nameDialog, setNameDialog] = useState<ChatSessionGroup | 'new' | null>(null);
  const [groupName, setGroupName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'ungrouped' | null>(null);
  const draggedSession = useRef<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const isMobile = () => window.innerWidth <= 768;

  const closeMobileSidebar = () => {
    setIsMobileOpen(false);
    window.requestAnimationFrame(() => mobileToggleRef.current?.focus());
  };

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobileViewport(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !isMobileOpen || !sidebarRef.current) return;
    const sidebar = sidebarRef.current;
    const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ant Design 的菜单和弹窗管理自己的键盘与焦点。
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('.ant-dropdown, .ant-modal-wrap'))) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileSidebar();
        return;
      }
      const controls = focusable();
      if (event.key !== 'Tab' || controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, isMobileViewport]);

  const handleCreateSession = async (groupId?: number | null) => {
    await createSession(undefined, groupId);
    if (isMobile()) closeMobileSidebar();
  };

  const confirmDeleteSession = (session: ChatSession) => {
    modal.confirm({
      title: '确定删除这个对话吗？',
      zIndex: 1400,
      content: '会删除整个会话及全部结果。只删某张图片请使用图片上的删除按钮。',
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => deleteSession(session.id),
    });
  };

  const busy = sessionNavigationPending > 0;
  const sections = buildSessionSections(sessions, sessionGroups, ungroupedCollapsed);
  const popupContainer = () => document.body;
  const openNameDialog = (group: ChatSessionGroup | 'new') => {
    setGroupName(group === 'new' ? '' : group.name);
    setNameDialog(group);
  };
  const saveGroupName = async () => {
    if (!nameDialog || !groupName.trim() || savingName) return;
    setSavingName(true);
    const saved = nameDialog === 'new'
      ? await createSessionGroup(groupName.trim())
      : await updateSessionGroup(nameDialog.id, { name: groupName.trim() });
    setSavingName(false);
    if (saved) setNameDialog(null);
  };
  const endDrag = () => {
    draggedSession.current = null;
    setDraggingSessionId(null);
    setDropTarget(null);
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId !== currentSessionId) {
      switchSession(sessionId);
    }
    if (isMobile()) closeMobileSidebar();
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

  const getSessionMenu = (session: ChatSession): MenuProps => ({
    items: [
      { key: 'pin', icon: session.is_pinned ? <PushpinFilled /> : <PushpinOutlined />, label: session.is_pinned ? '取消置顶' : '置顶' },
      { type: 'divider' },
      { key: 'move', icon: <FolderOutlined />, label: '移动到分组', popupClassName: 'session-navigation-submenu', children: sections.map(section => ({
        key: `move:${section.id ?? 'ungrouped'}`, label: section.name,
        disabled: (session.group_id ?? null) === section.id,
      })) },
      { type: 'divider' },
      { key: 'delete', icon: <DeleteOutlined />, label: '删除对话', danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'pin') void setSessionPinned(session.id, !session.is_pinned);
      else if (key === 'delete') confirmDeleteSession(session);
      else if (key.startsWith('move:')) void moveSessionToGroup(session.id, key === 'move:ungrouped' ? null : Number(key.slice(5)));
    },
  });

  const renderSession = (session: ChatSession) => (
    <Dropdown
      key={session.id}
      trigger={['contextMenu']}
      disabled={busy}
      getPopupContainer={popupContainer}
      classNames={{ root: 'session-navigation-dropdown' }}
      menu={getSessionMenu(session)}
    >
      <List.Item
        className={`session-item ${session.id === currentSessionId ? 'active' : ''} ${session.id === draggingSessionId ? 'is-dragging' : ''}`}
      >
        <button
          type="button"
          className="session-select"
          draggable={!busy && !isMobileViewport}
          onDragStart={event => {
            draggedSession.current = session.id;
            setDraggingSessionId(session.id);
            event.dataTransfer.setData('application/x-aidraw-session', session.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={endDrag}
          onClick={() => handleSwitchSession(session.id)}
          aria-current={session.id === currentSessionId ? 'page' : undefined}
        >
          {session.is_pinned
            ? <PushpinFilled className="session-icon session-pin-indicator" aria-label="已置顶" />
            : <MessageOutlined className="session-icon" />}
          <span className="session-copy">
            <span className="session-title">{session.title}</span>
            <span className="session-meta">
              <span>{formatDate(session.updated_at)}</span>
              <span>{session.message_count} 条</span>
            </span>
          </span>
        </button>

        <div className="session-actions">
          <Dropdown
            trigger={['click']}
            getPopupContainer={popupContainer}
            classNames={{ root: 'session-navigation-dropdown' }}
            menu={getSessionMenu(session)}
          >
            <Button type="text" size="small" disabled={busy} icon={<EllipsisOutlined />} aria-label={`更多操作 ${session.title}`} />
          </Dropdown>
        </div>
      </List.Item>
    </Dropdown>
  );

  const renderSection = (section: SessionSection) => {
    const key = section.id ?? 'ungrouped';
    const group = sessionGroups.find(item => item.id === section.id);
    const containsCurrent = section.sessions.some(session => session.id === currentSessionId);
    const labelId = `session-group-label-${key}`;
    const contentId = `session-group-content-${key}`;
    return (
      <section key={key} className="session-group" aria-labelledby={labelId}>
        <div
          className={`session-group-header ${containsCurrent ? 'contains-current' : ''} ${dropTarget === key ? 'is-drop-target' : ''}`}
          onDragOver={event => {
            const source = sessions.find(session => session.id === draggedSession.current);
            if (busy || !source || (source.group_id ?? null) === section.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget(key);
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
          }}
          onDrop={event => {
            event.preventDefault();
            const sessionId = draggedSession.current;
            endDrag();
            if (!busy && sessionId && (sessions.find(session => session.id === sessionId)?.group_id ?? null) !== section.id) {
              void moveSessionToGroup(sessionId, section.id);
            }
          }}
        >
          <button
            id={labelId}
            type="button"
            className="session-group-toggle"
            aria-expanded={!section.is_collapsed}
            aria-controls={contentId}
            title={section.name}
            disabled={busy}
            onClick={() => {
              if (section.id === null) void setUngroupedCollapsed(!section.is_collapsed);
              else void updateSessionGroup(section.id, { is_collapsed: !section.is_collapsed });
            }}
          >
            <RightOutlined className={`session-group-arrow ${section.is_collapsed ? '' : 'is-expanded'}`} />
            <span className="session-group-name">{section.name}</span>
            {section.is_pinned && <PushpinFilled className="session-group-pin" />}
            <span className="session-group-count">{section.sessions.length}</span>
            {containsCurrent && section.is_collapsed && <span className="session-group-current" aria-label="当前对话在此分组" />}
          </button>
          <Tooltip title={`在${section.name}中新建对话`}>
            <Button type="text" size="small" disabled={busy} icon={<PlusOutlined />}
              aria-label={`在${section.name}中新建对话`} onClick={() => void handleCreateSession(section.id)} />
          </Tooltip>
          {group && (
            <Dropdown trigger={['click']} getPopupContainer={popupContainer} classNames={{ root: 'session-navigation-dropdown' }} menu={{
              items: [
                { key: 'pin', icon: group.is_pinned ? <PushpinFilled /> : <PushpinOutlined />, label: group.is_pinned ? '取消置顶分组' : '置顶分组' },
                { key: 'rename', icon: <EditOutlined />, label: '重命名分组' },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: '删除分组', danger: true },
              ],
              onClick: ({ key: action }) => {
                if (action === 'pin') void updateSessionGroup(group.id, { is_pinned: !group.is_pinned });
                else if (action === 'rename') openNameDialog(group);
                else if (action === 'delete') modal.confirm({
                  title: `删除分组「${group.name}」？`, content: '组内对话将移回「未分组」，所有消息和素材都会保留。',
                  zIndex: 1400,
                  okText: '删除分组', cancelText: '取消', okButtonProps: { danger: true },
                  onOk: async () => { if (!await deleteSessionGroup(group.id)) throw new Error('删除分组失败'); },
                });
              },
            }}>
              <Button type="text" size="small" disabled={busy} icon={<EllipsisOutlined />} aria-label={`分组操作 ${group.name}`} />
            </Dropdown>
          )}
        </div>
        <div id={contentId} hidden={section.is_collapsed}>
          {section.sessions.length > 0 ? <List dataSource={section.sessions} renderItem={renderSession} /> : (
            <div className="session-group-empty">{section.id === null ? '还没有未分组的对话' : '暂无对话，可新建或拖入对话'}</div>
          )}
        </div>
      </section>
    );
  };

  return (
    <>
      <button
        className={`sidebar-overlay ${isMobileOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="关闭会话列表"
        aria-hidden={!isMobileOpen}
        tabIndex={isMobileOpen ? 0 : -1}
        onClick={closeMobileSidebar}
      />

      {!isMobileOpen && (
        <button
          ref={mobileToggleRef}
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
        ref={sidebarRef}
        id="chat-session-sidebar"
        className={`chat-session-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
        aria-label="会话导航"
        aria-hidden={isMobileViewport && !isMobileOpen}
        aria-modal={isMobileViewport && isMobileOpen ? true : undefined}
        role={isMobileViewport ? 'dialog' : undefined}
        inert={isMobileViewport && !isMobileOpen}
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
                    closeMobileSidebar();
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
              onClick={() => void handleCreateSession()}
              disabled={busy}
              aria-label="新对话"
            >
              <span className="new-chat-label">新对话</span>
            </Button>
          </Tooltip>
          <Tooltip title={sidebarCollapsed && !isMobileOpen ? '新建分组' : undefined} placement="right">
            <Button className="new-chat-button create-group-button" type="text" icon={<FolderAddOutlined />}
              disabled={busy} onClick={() => openNameDialog('new')} aria-label="新建分组">
              <span className="new-chat-label">新建分组</span>
            </Button>
          </Tooltip>
        </header>

        <nav className="session-list" aria-label="项目分组与会话" inert={sidebarCollapsed && !isMobileViewport}
          onDragOver={event => {
            if (!draggedSession.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientY < rect.top + 40) event.currentTarget.scrollTop -= 18;
            else if (event.clientY > rect.bottom - 40) event.currentTarget.scrollTop += 18;
          }}>
          {sessionNavigationError && <Alert type="error" title={sessionNavigationError} showIcon closable
            onClose={clearSessionNavigationError} action={<Button size="small" onClick={() => {
              void refreshSessionNavigation().catch(() => {});
            }}>重试</Button>} />}
          {sessionNavigationLoading && <div className="session-navigation-loading" role="status">正在加载会话…</div>}
          {sections.map(renderSection)}
        </nav>

        <footer className="sidebar-footer">
          <AccountMenu collapsed={sidebarCollapsed && !isMobileOpen} />
        </footer>
      </aside>
      <Modal title={nameDialog === 'new' ? '新建项目分组' : '重命名分组'} open={nameDialog !== null}
        zIndex={1400}
        onCancel={() => { if (!savingName) setNameDialog(null); }} onOk={() => void saveGroupName()}
        confirmLoading={savingName} okText="保存" cancelText="取消" okButtonProps={{ disabled: !groupName.trim() }}
        destroyOnHidden afterOpenChange={open => { if (!open) setGroupName(''); }}>
        <Input autoFocus aria-label="分组名称" placeholder="例如：游戏项目、角色设计" maxLength={100}
          value={groupName} onChange={event => setGroupName(event.target.value)} onPressEnter={() => void saveGroupName()} />
        {sessionNavigationError && <p role="alert" className="session-group-error">{sessionNavigationError}</p>}
      </Modal>
    </>
  );
}
