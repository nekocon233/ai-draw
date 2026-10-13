import { CheckCircleOutlined, ClockCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { Image } from 'antd';
import type { ReactNode } from 'react';
import type { ChatMessage } from '../../types/models';
import { answerReceipt, bubbleOptions, isVideoUrl, pickHint, questionStatus } from './bubbles';
import './AgentBubbles.css';

/** A review gate's question, kept in the session as the agent's bubble; the gate bar is where it is answered. */
export function AgentQuestionBubble({ message }: { message: ChatMessage }) {
  const options = bubbleOptions(message);
  return (
    <div className="agent-bubble">
      <div className="agent-bubble-label">
        <RobotOutlined aria-hidden="true" /> Agent 提问 · {pickHint(options)}
      </div>
      <div className="agent-bubble-text">{message.content}</div>
      <div className={`agent-bubble-status is-${String(options.status ?? 'open')}`}>{questionStatus(options)}</div>
    </div>
  );
}

/** The user's answer to a gate: what they chose (with the picks), their note, and whether the agent has read it. */
export function GateAnswerBubble({ message }: { message: ChatMessage }) {
  const picks = (message.params?.referenceImages ?? []).filter((url): url is string => Boolean(url));
  const receipt = answerReceipt(bubbleOptions(message));
  return (
    <div className="chat-message-bubble gate-answer">
      <div className="gate-answer-text">{message.content}</div>
      {picks.length > 0 && (
        <div className="gate-answer-picks">
          {picks.map(url => isVideoUrl(url) ? (
            <video key={url} src={`${url}#t=0.1`} muted playsInline controls preload="metadata" aria-label="选用的视频" />
          ) : (
            <Image key={url} src={url} alt="选用的结果" width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }}
              preview={{ mask: '预览' }} />
          ))}
        </div>
      )}
      <div className={`gate-answer-receipt ${receipt.read ? 'is-read' : ''}`} title={receipt.hint}>
        {receipt.read ? <CheckCircleOutlined aria-hidden="true" /> : <ClockCircleOutlined aria-hidden="true" />}
        <span>{receipt.text}</span>
      </div>
    </div>
  );
}

/** The text of assets the agent posted, on the agent's side above the media. */
export function AgentPostText({ text, actions }: { text: string; actions?: ReactNode }) {
  return (
    <div className="agent-bubble agent-post-text">
      <div className="agent-bubble-label">
        <RobotOutlined aria-hidden="true" /> Agent
        {actions && <span className="agent-bubble-actions">{actions}</span>}
      </div>
      <div className="agent-bubble-text">{text}</div>
    </div>
  );
}
