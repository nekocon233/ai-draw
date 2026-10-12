import { create } from 'zustand';
import { agentApi } from './api';
import { togglePick } from './gatePicks';
import type { GateDecision, GatePick, PickInput, ReviewGate } from './types';

interface GateStoreState {
  /** The open gate of each session (at most one per session). */
  gates: Record<string, ReviewGate>;
  /** Bumped when the user tries to submit without enough picks; the pick toggles pulse once. */
  nudges: number;
  nudge: () => void;
  load: (sessionId?: string) => Promise<void>;
  apply: (gate: ReviewGate) => void;
  toggle: (sessionId: string, pick: PickInput) => Promise<'ok' | 'limit' | 'error'>;
  submit: (sessionId: string, decision: GateDecision, note: string) => Promise<ReviewGate | null>;
  reset: () => void;
}

// Pick changes are sent as whole lists; only the newest response per gate may land.
const pickRequests = new Map<string, number>();
let loadSequence = 0;

function withoutSession(gates: Record<string, ReviewGate>, sessionId: string) {
  const next = { ...gates };
  delete next[sessionId];
  return next;
}

export const useGateStore = create<GateStoreState>((set, get) => ({
  gates: {},
  nudges: 0,
  nudge: () => set(state => ({ nudges: state.nudges + 1 })),

  load: async (sessionId) => {
    // Full reloads replace the whole map, so only the newest one may land; per-session loads are independent.
    const sequence = sessionId ? 0 : ++loadSequence;
    try {
      const { gates } = await agentApi.listGates({ status: 'open', session_id: sessionId, limit: 200 });
      if (!sessionId && sequence !== loadSequence) return;
      set(state => {
        const next = sessionId ? withoutSession(state.gates, sessionId) : {};
        for (const gate of gates) next[gate.session_id] = gate;
        return { gates: next };
      });
    } catch (error) {
      console.error('加载 Agent 审核失败:', error);
    }
  },

  apply: (gate) => set(state => {
    const current = state.gates[gate.session_id];
    if (gate.status !== 'open') {
      return current?.gate_id === gate.gate_id ? { gates: withoutSession(state.gates, gate.session_id) } : {};
    }
    // An older event must not undo a newer optimistic or server state of the same gate.
    if (current?.gate_id === gate.gate_id && current.updated_at > gate.updated_at) return {};
    return { gates: { ...state.gates, [gate.session_id]: gate } };
  }),

  toggle: async (sessionId, pick) => {
    const gate = get().gates[sessionId];
    if (!gate) return 'error';
    const next = togglePick(gate.picks, pick, gate.max_picks);
    if (next === null) return 'limit';
    const request = (pickRequests.get(gate.gate_id) ?? 0) + 1;
    pickRequests.set(gate.gate_id, request);
    const optimistic: GatePick[] = next.map(item => gate.picks.find(old => old.url === item.url && old.message_id === item.message_id)
      ?? { url: item.url, message_id: item.message_id ?? '', image_index: null, seed: null });
    set(state => ({ gates: { ...state.gates, [sessionId]: { ...gate, picks: optimistic } } }));
    try {
      const saved = await agentApi.setGatePicks(gate.gate_id, next);
      if (pickRequests.get(gate.gate_id) === request) get().apply(saved);
      return 'ok';
    } catch (error) {
      console.error('保存选用失败:', error);
      if (pickRequests.get(gate.gate_id) === request) {
        set(state => state.gates[sessionId]?.gate_id === gate.gate_id
          ? { gates: { ...state.gates, [sessionId]: gate } } : {});
      }
      return 'error';
    }
  },

  submit: async (sessionId, decision, note) => {
    const gate = get().gates[sessionId];
    if (!gate) return null;
    try {
      const saved = await agentApi.submitGate(gate.gate_id, { decision, note });
      get().apply(saved);
      return saved;
    } catch (error) {
      console.error('提交审核失败:', error);
      return null;
    }
  },

  reset: () => {
    pickRequests.clear();
    loadSequence += 1;
    set({ gates: {} });
  },
}));
