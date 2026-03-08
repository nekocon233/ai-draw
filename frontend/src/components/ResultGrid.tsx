import { useEffect, useRef } from 'react';
import { Image, Spin, Tag, Button } from 'antd';
import { DownloadOutlined, PictureOutlined, LoadingOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import './ResultGrid.css';

export default function ResultGrid() {
  const { chatHistory, imagesPerRow, currentSessionId } = useAppStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionId = useRef<string | null>(null);
  const prevHistoryLength = useRef<number>(0);

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
      <div className="chat-messages">
        {chatHistory.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.type === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
          >
            {message.type === 'user' ? (
              // 用户消息（右侧）
              <div className="chat-message-content user-message">
                <div className="chat-message-bubble">
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
