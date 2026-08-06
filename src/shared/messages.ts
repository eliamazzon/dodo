import type { AgentState, Settings, HistoryItem, Mode, AllowlistEntry, PermissionScope, PermissionDuration } from './types';

export type PanelToBg =
  | { kind: 'send_message'; text: string }
  | { kind: 'approve_execution'; messageId: string }
  | { kind: 'reject_execution'; messageId: string }
  | { kind: 'stop' }
  | { kind: 'allow_host'; pattern: string; scope: PermissionScope; duration: PermissionDuration }
  | { kind: 'deny_permission' }
  | { kind: 'confirm_critical'; messageId: string }
  | { kind: 'deny_critical'; messageId: string }
  | { kind: 'retry' }
  | { kind: 'reset' }
  | { kind: 'set_mode'; mode: Mode }
  | { kind: 'set_settings'; patch: Partial<Settings> }
  | { kind: 'test_notify' }
  | { kind: 'open_history'; id: string }
  | { kind: 'delete_history'; id: string };

export type BgToPanel =
  | { kind: 'state'; state: AgentState; settings: Settings; allowlist: AllowlistEntry[]; history: HistoryItem[] };

// `confirmed`: the user has already approved this as a critical action — skip the guardrail re-check
// and perform the op. The background re-issues the same op with confirmed:true after the user confirms.
export type ContentOp =
  | { op: 'click'; selector: string; showOverlay?: boolean; confirmed?: boolean }
  | { op: 'type'; selector: string; text: string; perChar?: boolean; showOverlay?: boolean; confirmed?: boolean } // perChar: type one char at a time with real key events (for autocomplete/combobox dropdowns)
  | { op: 'press'; selector?: string; key: string; modifiers?: ('Meta' | 'Control' | 'Alt' | 'Shift')[]; showOverlay?: boolean; confirmed?: boolean } // dispatch a real key event (Enter/Tab/Escape/arrows) to commit/submit/dismiss
  | { op: 'extract'; selector?: string; mode?: 'text' | 'map' }
  | { op: 'snapshot'; selector?: string; depth?: number }
  | { op: 'snapshot_structured' } // structured elements[] — kept for the disabled planner path
  | { op: 'set_working'; working: boolean }; // toggle the "agent is here" title prefix on this tab

export type ContentResult =
  | { ok: true; data: unknown }
  // `critical` flags a checkout/payment-shaped action the guardrail paused — the background turns it
  // into a user confirmation card, then re-issues the op with confirmed:true if approved.
  | { ok: false; error: string; critical?: { reason: string; label: string } };

export const PORT_NAME = 'dodo-agent';
