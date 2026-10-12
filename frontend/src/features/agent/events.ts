import type { WSMessage } from '../../types/api.ts';
import type { AgentSessionEvent, ReviewGate } from './types.ts';

const GATE_STATUSES = new Set(['open', 'submitted', 'cancelled']);

export interface AgentEventPort {
  currentSessionId(): string | null;
  applyGate(gate: ReviewGate): void;
  reloadGates(): Promise<void>;
  refreshSessions(): Promise<void>;
  syncSession(sessionId: string): Promise<void>;
}

export function isReviewGate(value: unknown): value is ReviewGate {
  if (!value || typeof value !== 'object') return false;
  const gate = value as Partial<ReviewGate>;
  return typeof gate.gate_id === 'string' && typeof gate.session_id === 'string'
    && typeof gate.question === 'string' && typeof gate.status === 'string' && GATE_STATUSES.has(gate.status)
    && typeof gate.min_picks === 'number' && typeof gate.max_picks === 'number' && Array.isArray(gate.picks);
}

export function isAgentSessionEvent(value: unknown): value is AgentSessionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AgentSessionEvent>;
  return (event.reason === 'session_created' || event.reason === 'round_posted') && typeof event.session_id === 'string';
}

/** Gates and posted rounds from agents; generation progress itself stays in the generation handler. */
export function createAgentEventHandler(port: AgentEventPort) {
  return async (message: WSMessage): Promise<void> => {
    if (message.type === 'initial_state') {
      // A reconnect may have missed gate changes and posted rounds.
      await port.reloadGates();
      const sessionId = port.currentSessionId();
      if (sessionId) await port.syncSession(sessionId);
      return;
    }
    if (message.type !== 'state_change') return;
    if (message.field === 'agent_gate') {
      if (isReviewGate(message.value)) port.applyGate(message.value);
      return;
    }
    if (message.field === 'agent_session' && isAgentSessionEvent(message.value)) {
      await port.refreshSessions();
      if (message.value.reason === 'round_posted' && message.value.session_id === port.currentSessionId()) {
        await port.syncSession(message.value.session_id);
      }
    }
  };
}
