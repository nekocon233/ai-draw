import { App } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { isPicked } from './gatePicks';
import { useGateStore } from './gateStore';
import './GatePickToggle.css';

interface GatePickToggleProps {
  sessionId: string;
  messageId: string;
  url: string;
  /** Long strips keep their actions on top, so the toggle moves to the bottom. */
  strip?: boolean;
}

/** “选用” on a result while the agent waits for a choice in this session. */
export default function GatePickToggle({ sessionId, messageId, url, strip = false }: GatePickToggleProps) {
  const gate = useGateStore(state => state.gates[sessionId]);
  const toggle = useGateStore(state => state.toggle);
  const nudges = useGateStore(state => state.nudges);
  const { message } = App.useApp();
  if (!gate || gate.max_picks === 0) return null;

  const pick = { url, message_id: messageId };
  const picked = isPicked(gate.picks, pick);
  const onClick = async () => {
    const result = await toggle(sessionId, pick);
    if (result === 'limit') void message.info(`最多选 ${gate.max_picks} 个，先取消一个再选`);
  };

  return (
    <>
      {picked && <span className="gate-pick-outline" aria-hidden="true" />}
      <button
        type="button"
        // Two identical animations alternate so every nudge restarts the pulse.
        className={`gate-pick-toggle${picked ? ' is-picked' : ''}${strip ? ' is-strip' : ''}${!picked && nudges ? ` is-nudged-${nudges % 2}` : ''}`}
        aria-pressed={picked}
        aria-label={picked ? '取消选用' : '选用这个结果'}
        onClick={() => void onClick()}
      >
        {picked ? <><CheckOutlined aria-hidden="true" /> 已选</> : '选用'}
      </button>
    </>
  );
}
