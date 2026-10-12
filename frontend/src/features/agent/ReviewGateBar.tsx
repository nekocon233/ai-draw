import { useEffect, useRef, useState } from 'react';
import { App, Button, Input, Tag } from 'antd';
import { CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useAppStore } from '../../stores/appStore';
import { isVideoUrl } from '../../utils/media';
import { approveBlocker, pickSummary } from './gatePicks';
import { useGateStore } from './gateStore';
import type { GateDecision, ReviewGate } from './types';
import './ReviewGateBar.css';

function GateBody({ gate }: { gate: ReviewGate }) {
  const toggle = useGateStore(state => state.toggle);
  const submit = useGateStore(state => state.submit);
  const nudge = useGateStore(state => state.nudge);
  const { message } = App.useApp();
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState<GateDecision | null>(null);
  const count = gate.picks.length;
  const confirmOnly = gate.max_picks === 0;

  const send = async (decision: GateDecision) => {
    const blocker = decision === 'approve' ? approveBlocker(gate, count) : null;
    if (blocker) {
      // Explain instead of a silently disabled button, and point at the toggles.
      void message.info(blocker);
      nudge();
      return;
    }
    setSending(decision);
    const saved = await submit(gate.session_id, decision, note.trim());
    setSending(null);
    if (saved) void message.success(decision === 'approve' ? '已提交给 Agent' : '已请 Agent 重来');
  };

  return (
    <section className="review-gate-bar" data-expanded={expanded} aria-label="Agent 审核">
      <div className="review-gate-header">
        <Tag color="processing" className="review-gate-tag">Agent 审核</Tag>
        {(gate.job || gate.step) && (
          <Tag className="review-gate-tag review-gate-step">{[gate.job, gate.step].filter(Boolean).join(' · ')}</Tag>
        )}
        <span className={`review-gate-summary${!confirmOnly && count === 0 ? ' is-empty' : ''}`}>{pickSummary(gate, count)}</span>
        <Button
          type="text"
          size="small"
          className="review-gate-expand"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          aria-expanded={expanded}
          aria-label={expanded ? '收起审核' : '展开审核'}
          onClick={() => setExpanded(value => !value)}
        />
      </div>
      <div className="review-gate-body">
        <p className="review-gate-question">{gate.question}</p>
        {!confirmOnly && count === 0 && (
          <p className="review-gate-hint">在上方结果右上角点「选用」，本会话任意一轮都可以选，也可以选你自己生成的图。</p>
        )}
        {count > 0 && (
          <ul className="review-gate-picks" aria-label="已选结果">
            {gate.picks.map((pick, index) => (
              <li key={`${pick.message_id}:${pick.url}`} className="review-gate-pick">
                {isVideoUrl(pick.url)
                  ? <video src={`${pick.url}#t=0.1`} muted playsInline preload="metadata" aria-label={`已选视频 ${index + 1}`} />
                  : <img src={pick.url} alt={`已选结果 ${index + 1}`} loading="lazy" />}
                <button
                  type="button"
                  className="review-gate-unpick"
                  aria-label={`取消选用第 ${index + 1} 个`}
                  onClick={() => void toggle(gate.session_id, { url: pick.url, message_id: pick.message_id })}
                >
                  <CloseOutlined aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Input.TextArea
          className="review-gate-note"
          value={note}
          onChange={event => setNote(event.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={4000}
          placeholder="补充说明（可选）…"
          aria-label="给 Agent 的补充说明"
        />
        <div className="review-gate-actions">
          <Button onClick={() => void send('redo')} loading={sending === 'redo'} disabled={sending !== null}>
            都不满意，重来
          </Button>
          <Button
            type="primary"
            onClick={() => void send('approve')}
            loading={sending === 'approve'}
            disabled={sending !== null}
          >
            {confirmOnly ? '通过' : '提交给 Agent'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The agent's open question for the visible session, plus a notice for questions waiting elsewhere. */
export default function ReviewGateBar() {
  const currentSessionId = useAppStore(state => state.currentSessionId);
  const sessions = useAppStore(state => state.sessions);
  const switchSession = useAppStore(state => state.switchSession);
  const gates = useGateStore(state => state.gates);
  const { notification } = App.useApp();
  const announced = useRef(new Map<string, string>());

  useEffect(() => {
    // A deleted session takes its gates with it (database cascade, no event), so drop gates of unknown sessions.
    const known = new Set(sessions.map(item => item.id));
    const open = new Map(Object.values(gates)
      .filter(gate => sessions.length === 0 || known.has(gate.session_id))
      .map(gate => [gate.gate_id, gate]));
    for (const [gateId, sessionId] of announced.current) {
      if (!open.has(gateId) || sessionId === currentSessionId) notification.destroy(`agent-gate-${gateId}`);
      if (!open.has(gateId)) announced.current.delete(gateId);
    }
    for (const gate of open.values()) {
      if (announced.current.has(gate.gate_id)) continue;
      announced.current.set(gate.gate_id, gate.session_id);
      if (gate.session_id === currentSessionId) continue;
      const key = `agent-gate-${gate.gate_id}`;
      const title = sessions.find(item => item.id === gate.session_id)?.title;
      notification.info({
        key,
        title: 'Agent 等你审核',
        description: title ? `「${title}」：${gate.question}` : gate.question,
        duration: false,
        actions: (
          <Button type="primary" size="small" onClick={() => { notification.destroy(key); void switchSession(gate.session_id); }}>
            前往
          </Button>
        ),
      });
    }
  }, [gates, currentSessionId, sessions, notification, switchSession]);

  const gate = currentSessionId ? gates[currentSessionId] : undefined;
  return gate ? <GateBody key={gate.gate_id} gate={gate} /> : null;
}
