/** A result the user chose for an agent's review question. */
export interface GatePick {
  url: string;
  message_id: string;
  image_index: number | null;
  seed: number | null;
}

/** What the UI sends; the server resolves the round and seed. */
export interface PickInput {
  url: string;
  message_id?: string;
}

export type GateStatus = 'open' | 'submitted' | 'cancelled';
export type GateDecision = 'approve' | 'redo';

export interface ReviewGate {
  gate_id: string;
  session_id: string;
  job: string | null;
  step: string | null;
  question: string;
  min_picks: number;
  /** 0 means the agent only asks for confirmation. */
  max_picks: number;
  rounds: string[];
  status: GateStatus;
  decision: GateDecision | null;
  picks: GatePick[];
  note: string;
  cancel_reason: string | null;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
}

export interface AgentSessionEvent {
  reason: 'session_created' | 'round_posted';
  session_id: string;
  message_id?: string;
  reply_id?: string;
}
