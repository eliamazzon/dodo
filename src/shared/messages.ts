import type { AgentState, Settings, HistoryItem, Mode, ApprovalMode } from './types';

export type PanelToBg =
  | { kind: 'send_message'; text: string }
  | { kind: 'approve_execution'; messageId: string }
  | { kind: 'reject_execution'; messageId: string }
  | { kind: 'stop' }
  | { kind: 'allow_host'; host: string; remember: boolean }
  | { kind: 'deny_permission' }
  | { kind: 'retry' }
  | { kind: 'reset' }
  | { kind: 'set_mode'; mode: Mode }
  | { kind: 'set_approval_mode'; mode: ApprovalMode }
  | { kind: 'test_notify' }
  | { kind: 'open_history'; id: string }
  | { kind: 'delete_history'; id: string };

export type BgToPanel =
  | { kind: 'state'; state: AgentState; settings: Settings; allowlist: string[]; history: HistoryItem[] };

export type ContentOp =
  | { op: 'click'; selector: string }
  | { op: 'type'; selector: string; text: string }
  | { op: 'extract'; selector?: string }
  | { op: 'snapshot'; selector?: string; depth?: number }
  | { op: 'snapshot_structured' }; // structured elements[] — kept for the disabled planner path

export type ContentResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const PORT_NAME = 'dodo-agent';
