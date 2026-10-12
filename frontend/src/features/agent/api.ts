import client from '../../api/client';
import type { GateDecision, GateStatus, PickInput, ReviewGate } from './types';

export const agentApi = {
  listGates: (params: { session_id?: string; status?: GateStatus; limit?: number }): Promise<{ gates: ReviewGate[] }> =>
    client.get('/agent/gates', { params }),

  setGatePicks: (gateId: string, picks: PickInput[]): Promise<ReviewGate> =>
    client.put(`/agent/gates/${encodeURIComponent(gateId)}/picks`, { picks }),

  submitGate: (gateId: string, body: { decision: GateDecision; note?: string }): Promise<ReviewGate> =>
    client.post(`/agent/gates/${encodeURIComponent(gateId)}/submit`, body),
};
