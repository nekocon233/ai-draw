import { useEffect, useRef, useState, useCallback } from 'react';
import { Image, Spin, Tag, Button, Popconfirm, Input } from 'antd';
import {
  DownloadOutlined, PictureOutlined, LoadingOutlined,
  DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import './ResultGrid.css';

export default function ResultGrid() {
  const { chatHistory, imagesPerRow, currentSessionId, isGenerating, deleteChatMessage, editAndRegenerateMessage } = useAppStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionId = useRef<string | null>(null);
  const prevHistoryLength = useRef<number>(0);

  // ---- 编辑状态 ----
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editPromptEnd, setEditPromptEnd] = useState('');
  const [editRefImages, setEditRefImages] = useState<{
    img1?: string | null;
    img2?: string | null;
    img3?: string | null;
  }>({});
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const activeRefSlot = useRef<1 | 2 | 3>(1);

  const startEdit = useCallback((message: { id: string; content: string; params?: { promptEnd?: string; referenceImage?: string; referenceImage2?: string; referenceImage3?: string } }) => {
    setEditingMsgId(message.id);
    setEditContent(message.content);
    setEditPromptEnd(message.params?.promptEnd || '');
    setEditRefImages({
      img1: message.params?.referenceImage ?? null,
      img2: message.params?.referenceImage2 ?? null,
      img3: message.params?.referenceImage3 ?? null,
    });
  }, []);

  const cancelEdit = useCallback(() => setEditingMsgId(null), []);

  const confirmEdit = useCallback(async (msgId: string) => {
    // 立即退出编辑模式，不等待生成完成
    const content = editContent;
    const refImages = { ...editRefImages };
    const promptEnd = editPromptEnd;
    setEditingMsgId(null);
    await editAndRegenerateMessage(msgId, content, {
      referenceImage: refImages.img1,
      referenceImage2: refImages.img2,
      referenceImage3: refImages.img3,
    }, promptEnd);
  }, [editAndRegenerateMessage, editContent, editPromptEnd, editRefImages]);

  const handleEditFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      const slot = activeRefSlot.current;
      setEditRefImages(prev => ({ ...prev, [`img${slot}`]: base64 }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // 统一的滚动逻辑
  useEffect(() => {
    const sessionChanged = currentSessionId && currentSessionId !== prevSessionId.current;
    const historyChanged = chatHistory.length !== prevHistoryLength.current;
    
    if (sessionChanged) {
      // 会话切换：记录新会话ID，不更新 historyLength
      prevSessionId.current = currentSessionId;
      // 等待新会话的历史加载完成后，由 historyChanged 触发滚动
    }
    
    if (historyChanged && chatHistory.length > 0) {
      // 历史更新：平滑滚动（包括会话切换后的首次加载）
      prevHistoryLength.current = chatHistory.length;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [chatHistory, currentSessionId]);

  const isVideo = (url: string) => url.startsWith('data:video/') || /\.(mp4|webm)$/i.test(url) || url.includes('/video/');

  const downloadImage = (imageUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `ai-draw-${Date.now()}-${index + 1}.${isVideo(imageUrl) ? 'mp4' : 'png'}`;
    link.click();
  };

  if (chatHistory.length === 0) {
    return (
      <div className="result-container">
        <div className="result-empty">
          <PictureOutlined className="result-empty-icon" />
          <span className="result-empty-text">暂无生成结果</span>
        </div>
      </div>
    );
  }

  return (
    <div className="result-container">
      {/* 隐藏的文件选择器（编辑模式参考图上传） */}
      <input
        ref={editFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleEditFileChange}
      />
      <div className="chat-messages">
        {chatHistory.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.type === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
          >
            {message.type === 'user' ? (
              // 用户消息（右侧）
              <div className="chat-message-content user-message">
                {/* 删除按钮 */}
                <Popconfirm
                  title="确认删除这轮对话？"
                  onConfirm={() => deleteChatMessage(message.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  placement="topLeft"
                  disabled={editingMsgId === message.id}
                >
                  <Button
                    className="delete-round-btn"
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={editingMsgId === message.id || isGenerating}
                  />
                </Popconfirm>
                {/* 编辑按钮 */}
                <Button
                  className="edit-round-btn"
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  disabled={isGenerating}
                  onClick={() => startEdit(message)}
                  style={{ display: editingMsgId === message.id ? 'none' : undefined }}
                />
                <div className="chat-message-bubble">
                  {editingMsgId === message.id ? (
                    /* ======= 编辑模式 ======= */
                    <div className="chat-message-edit-mode">
                      {/* 参考图编辑区 */}
                      {(editRefImages.img1 || editRefImages.img2 || editRefImages.img3 ||
                        message.params?.referenceImage || message.params?.referenceImage2 || message.params?.referenceImage3) && (
                        <div className="user-reference-images edit-ref-images">
                          {(['img1', 'img2', 'img3'] as const).map((slot, i) => {
                            const src = editRefImages[slot];
                            const slotNum = (i + 1) as 1 | 2 | 3;
                            return src ? (
                              <div key={slot} className="edit-ref-image-tile">
                                <img src={src} alt={`参考图 ${slotNum}`} className="edit-ref-thumb" />
                                <button
                                  className="edit-ref-remove"
                                  onClick={() => setEditRefImages(prev => ({ ...prev, [slot]: null }))}
                                >
                                  <CloseOutlined />
                                </button>
                                <button
                                  className="edit-ref-replace"
                                  onClick={() => { activeRefSlot.current = slotNum; editFileInputRef.current?.click(); }}
                                  title="点击更换图片"
                                >
                                  <EditOutlined />
                                </button>
                              </div>
                            ) : (
                              <button
                                key={slot}
                                className="edit-ref-add"
                                onClick={() => { activeRefSlot.current = slotNum; editFileInputRef.current?.click(); }}
                                title={`添加参考图 ${slotNum}`}
                              >
                                <PlusOutlined />
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* 提示词文本编辑 */}
                      <Input.TextArea
                        className="edit-content-textarea"
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        placeholder="输入提示词…"
                      />

                      {/* 尾帧提示词（flf2v 循环模式） */}
                      {message.params?.isLoop && (
                        <Input.TextArea
                          className="edit-content-textarea edit-content-textarea-end"
                          value={editPromptEnd}
                          onChange={e => setEditPromptEnd(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          placeholder="结束帧提示词…"
                        />
                      )}

                      {/* 参数标签（只读）+ 操作按钮 */}
                      {message.params && (
                        <div className="chat-message-params">
                          <Tag>{message.params.workflow}</Tag>
                          {message.params.strength != null && <Tag>强度: {message.params.strength}</Tag>}
                          {message.params.count != null && message.params.count > 1 && <Tag>数量: {message.params.count}</Tag>}
                          {message.params.loraPrompt && <Tag>LoRA: {message.params.loraPrompt}</Tag>}
                        </div>
                      )}
                      <div className="edit-actions">
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => confirmEdit(message.id)}
                          disabled={!editContent.trim()}
                        >
                          重新生成
                        </Button>
                        <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* ======= 正常显示模式 ======= */
                    <>
                  {/* 参考图缩略图（可点击预览） */}
                  {(message.params?.referenceImage || message.params?.referenceImage2 || message.params?.referenceImage3 || message.params?.referenceImageEnd) && (
                    <div className="user-reference-images">
                      {([
                        { src: message.params.referenceImage, label: '参考图 1' },
                        { src: message.params.referenceImage2, label: '参考图 2' },
                        { src: message.params.referenceImage3, label: '参考图 3' },
                        { src: message.params.referenceImageEnd, label: '尾帧参考图' },
                      ] as { src?: string; label: string }[]).filter(item => item.src).map((item) => (
                        <div
                          key={item.label}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/uri-list', item.src!);
                            e.dataTransfer.setData('text/plain', item.src!);
                            e.dataTransfer.effectAllowed = 'copy';
                            const PREVIEW_SIZE = 80;
                            const imgEl = (e.currentTarget as HTMLElement).querySelector('img');
                            const canvas = document.createElement('canvas');
                            canvas.width = PREVIEW_SIZE;
                            canvas.height = PREVIEW_SIZE;
                            canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                            document.body.appendChild(canvas);
                            if (imgEl) {
                              const ctx = canvas.getContext('2d');
                              const scale = Math.min(PREVIEW_SIZE / imgEl.naturalWidth, PREVIEW_SIZE / imgEl.naturalHeight);
                              const w = imgEl.naturalWidth * scale;
                              const h = imgEl.naturalHeight * scale;
                              ctx?.drawImage(imgEl, (PREVIEW_SIZE - w) / 2, (PREVIEW_SIZE - h) / 2, w, h);
                            }
                            e.dataTransfer.setDragImage(canvas, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
                            setTimeout(() => document.body.removeChild(canvas), 0);
                          }}
                          style={{ cursor: 'grab', display: 'inline-block', borderRadius: 6, overflow: 'hidden' }}
                          title={`拖动${item.label}到输入框`}
                        >
                          <Image
                            src={item.src}
                            alt={item.label}
                            width={80}
                            height={80}
                            style={{ objectFit: 'cover', borderRadius: 6, display: 'block' }}
                            preview={{ mask: '预览' }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="chat-message-text">{message.content}</div>
                  {message.params?.isLoop && message.params?.promptEnd && (
                    <div className="chat-message-text chat-message-text-end">{message.params.promptEnd}</div>
                  )}
                  {message.params && (
                    <div className="chat-message-params">
                      <Tag>{message.params.workflow}</Tag>
                      {message.params.strength != null && (
                        <Tag>强度: {message.params.strength}</Tag>
                      )}
                      {message.params.count != null && message.params.count > 1 && (
                        <Tag>数量: {message.params.count}</Tag>
                      )}
                      {message.params.loraPrompt && (
                        <Tag>LoRA: {message.params.loraPrompt}</Tag>
                      )}
                      {message.params.frameRate != null && (
                        <Tag>帧率: {message.params.frameRate}</Tag>
                      )}
                      {message.params.startFrameCount != null && (
                        <Tag>起始帧: {message.params.startFrameCount}</Tag>
                      )}
                      {message.params.isLoop && message.params.endFrameCount != null && (
                        <Tag>结束帧: {message.params.endFrameCount}</Tag>
                      )}
                    </div>
                  )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              // AI 回复（左侧）- 图片网格
              <div className="chat-message-content assistant-message">
                <div 
                  className="chat-images-grid"
                  style={{ gridTemplateColumns: `repeat(${imagesPerRow}, 1fr)` }}
                >
                  {message.images && message.images.map((image, imgIndex) => (
                    <div key={imgIndex} className="chat-image-item">
                      {typeof image === 'string' ? (
                        <div 
                          className="chat-image-wrapper"
                          draggable={!isVideo(image)}
                          onDragStart={(e) => {
                            if (isVideo(image)) return;
                            // 设置拖放数据，确保目标可以接收到图片 URL
                            e.dataTransfer.setData('text/uri-list', image);
                            e.dataTransfer.setData('text/plain', image);
                            e.dataTransfer.effectAllowed = 'copy';
                            
                            // 用已渲染的 img 元素同步绘制缩略图，避免显示原图大尺寸
                            const PREVIEW_SIZE = 120;
                            const imgEl = (e.currentTarget as HTMLElement).querySelector('img');
                            const canvas = document.createElement('canvas');
                            canvas.width = PREVIEW_SIZE;
                            canvas.height = PREVIEW_SIZE;
                            canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                            document.body.appendChild(canvas);
                            if (imgEl) {
                              const ctx = canvas.getContext('2d');
                              const scale = Math.min(PREVIEW_SIZE / imgEl.naturalWidth, PREVIEW_SIZE / imgEl.naturalHeight);
                              const w = imgEl.naturalWidth * scale;
                              const h = imgEl.naturalHeight * scale;
                              ctx?.drawImage(imgEl, (PREVIEW_SIZE - w) / 2, (PREVIEW_SIZE - h) / 2, w, h);
                            }
                            e.dataTransfer.setDragImage(canvas, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
                            setTimeout(() => document.body.removeChild(canvas), 0);
                          }}
                          style={{ cursor: isVideo(image) ? 'default' : 'grab' }}
                        >
                          {isVideo(image) ? (
                            <video
                              src={image}
                              controls
                              style={{ width: '100%', maxHeight: 400, borderRadius: 4, display: 'block' }}
                            />
                          ) : (
                            <Image
                              src={image}
                              alt={`生成图片 ${imgIndex + 1}`}
                              className="chat-image"
                              preview={{ mask: '预览' }}
                            />
                          )}
                          <div className="chat-image-overlay">
                            <Button
                              type="primary"
                              size="small"
                              icon={<DownloadOutlined />}
                              onClick={() => downloadImage(image, imgIndex)}
                            >
                              下载
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="chat-image-loading">
                          <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
                          <div className="chat-loading-text">生成中...</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {/* 滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
