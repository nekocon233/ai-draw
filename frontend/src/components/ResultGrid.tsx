import { useEffect, useRef } from 'react';
import { Image, Spin, Tag, Button } from 'antd';
import { DownloadOutlined, PictureOutlined, LoadingOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import './ResultGrid.css';

export default function ResultGrid() {
  const { chatHistory, imagesPerRow, currentSessionId, currentGeneratingMessageId, isGenerating } = useAppStore();
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

  const downloadImage = (imageUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `ai-draw-${Date.now()}-${index + 1}.png`;
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
                  <div className="chat-message-text">{message.content}</div>
                  {message.params && (
                    <div className="chat-message-params">
                      <Tag>{message.params.workflow}</Tag>
                      <Tag>强度: {message.params.strength}</Tag>
                      <Tag>数量: {message.params.count}</Tag>
                      {message.params.loraPrompt && (
                        <Tag>LoRA: {message.params.loraPrompt}</Tag>
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
                          draggable={true}
                          onDragStart={(e) => {
                            // 设置拖放数据，确保目标可以接收到图片 URL
                            e.dataTransfer.setData('text/uri-list', image);
                            e.dataTransfer.setData('text/plain', image);
                            e.dataTransfer.effectAllowed = 'copy';
                            
                            // 创建拖放时的预览图
                            const img = new window.Image();
                            img.src = image;
                            e.dataTransfer.setDragImage(img, 50, 50);
                          }}
                          style={{ cursor: 'grab' }}
                        >
                          <Image
                            src={image}
                            alt={`生成图片 ${imgIndex + 1}`}
                            className="chat-image"
                            preview={{ mask: '预览' }}
                          />
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
                          {'error' in image ? (
                            <>
                              <div className="chat-loading-text" style={{ color: '#ff4d4f' }}>{image.message}</div>
                            </>
                          ) : 'storage' in image ? (
                            <>
                              <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
                              <div className="chat-loading-text">恢复中...</div>
                            </>
                          ) : (
                            <>
                              {isGenerating && message.id === currentGeneratingMessageId ? (
                                <>
                                  <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
                                  <div className="chat-loading-text">生成中...</div>
                                </>
                              ) : (
                                <div className="chat-loading-text" style={{ color: '#ff4d4f' }}>生成失败</div>
                              )}
                            </>
                          )}
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
