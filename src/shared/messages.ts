import type { AgentState, Settings, HistoryItem, Mode } from './types';

export type PanelToBg =
  | { kind: 'submit_task'; task: string }
  | { kind: 'continue_chat'; text: string }
  | { kind: 'approve_plan' }
  | { kind: 'edit_plan' }
  | { kind: 'stop' }
  | { kind: 'allow_host'; host: string; remember: boolean }
  | { kind: 'deny_permission' }
  | { kind: 'retry' }
  | { kind: 'reset' }
  | { kind: 'set_mode'; mode: Mode }
  | { kind: 'test_notify' }
  | { kind: 'open_history'; id: string }
  | { kind: 'delete_history'; id: string };

export type BgToPanel =
  | { kind: 'state'; state: AgentState; settings: Settings; allowlist: string[]; history: HistoryItem[] };

export type ContentOp =
  | { op: 'click'; selector: string }
  | { op: 'type'; selector: string; text: string }
  | { op: 'extract'; selector?: string }
  | { op: 'snapshot' };

export type ContentResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const PORT_NAME = 'dodo-agent';
