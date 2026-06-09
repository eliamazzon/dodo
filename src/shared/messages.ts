import type { AgentState, Settings, HistoryItem, Mode } from './types';

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
  | { kind: 'set_settings'; patch: Partial<Settings> }
  | { kind: 'test_notify' }
  | { kind: 'open_history'; id: string }
  | { kind: 'delete_history'; id: string };

export type BgToPanel =
  | { kind: 'state'; state: AgentState; settings: Settings; allowlist: string[]; history: HistoryItem[] };

export type ContentOp =
  | { op: 'click'; selector: string }
  | { op: 'type'; selector: string; text: string; perChar?: boolean } // perChar: type one char at a time with real key events (for autocomplete/combobox dropdowns)
  | { op: 'press'; selector?: string; key: string; modifiers?: ('Meta' | 'Control' | 'Alt' | 'Shift')[] } // dispatch a real key event (Enter/Tab/Escape/arrows) to commit/submit/dismiss
  | { op: 'extract'; selector?: string; mode?: 'text' | 'map' }
  | { op: 'snapshot'; selector?: string; depth?: number }
  | { op: 'snapshot_structured' } // structured elements[] — kept for the disabled planner path
  | { op: 'set_working'; working: boolean }; // toggle the "agent is here" title prefix on this tab

export type ContentResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const PORT_NAME = 'dodo-agent';
