// 'ask' requires user approval before each navigation; 'auto' runs fully autonomously; 'watch' observes without acting.
export type Mode = 'ask' | 'auto' | 'watch';

// Gates execute_actions. 'always_ask' surfaces an inline Approve/Reject card; 'auto_accept' runs immediately.
export type ApprovalMode = 'always_ask' | 'auto_accept';

// Granularity of a permission grant. 'domain' matches a host (with the *.example.com wildcard syntax);
// 'page' matches one exact page (origin + pathname, query/hash stripped).
export type PermissionScope = 'page' | 'domain';

// How long a permission grant lasts. 'once' = this single action only (nothing stored); 'session' =
// the rest of the current agent run (in-memory, cleared when control returns to the user); 'always' =
// persisted to the allowlist forever.
export type PermissionDuration = 'once' | 'session' | 'always';

// A persisted allowlist entry. `pattern` is a host (domain scope) or a page key (page scope).
// `user: true` marks an entry the user explicitly granted via the in-chat "always allow" prompt (as
// opposed to a seeded default or an onboarding-selected domain). Explicit user grants are honored even
// in 'ask' mode — "always allow" means don't ask again — whereas seeded/onboarding entries still prompt
// in 'ask' mode.
export type AllowlistEntry = { pattern: string; scope: PermissionScope; user?: boolean };

export type Settings = {
  providerId: string;
  apiKey: string;
  model: string;
  defaultMode: Mode;
  approvalMode: ApprovalMode;
  confirmNavigation: boolean;
  screenshotRedaction: boolean;
  notifyEnabled: boolean;
  notifyDismissed: boolean;
  onboarded: boolean;
  showCursorOverlay: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  providerId: 'gemini',
  apiKey: '',
  model: 'gemini-3.5-flash',
  defaultMode: 'ask',
  approvalMode: 'always_ask',
  confirmNavigation: true,
  screenshotRedaction: true,
  notifyEnabled: false,
  notifyDismissed: false,
  onboarded: false,
  showCursorOverlay: true,
};

// Internal planner output. Not part of AgentState; lives inside plan_proposal UIMessages.
export type Plan = {
  sites: string[];
  steps: string[];
  script: ScriptStep[];
  explanation?: string;
};

export type ScriptTarget = {
  text?: string;
  aria?: string;
  placeholder?: string;
  role?: string;
  type?: string;
};

export type ScriptStep =
  | { action: 'navigate'; url: string; description?: string }
  | { action: 'snapshot'; description?: string }
  | { action: 'click'; target: ScriptTarget; description?: string }
  | { action: 'type'; target: ScriptTarget; text: string; description?: string }
  | { action: 'extract'; description?: string };

export type SnapshotElement = {
  tag: string;
  selector: string;
  text?: string;
  aria?: string;
  placeholder?: string;
  role?: string;
  type?: string;
  value?: string;
  href?: string;
};

export type SnapshotResult = {
  title: string;
  url: string;
  elements: SnapshotElement[];
};

// HTML snapshot — what the granular snapshot() tool returns to the orchestrator LLM.
export type HtmlSnapshotResult = {
  title: string;
  url: string;
  html: string;
};

export type ToolName =
  | 'snapshot'
  | 'screenshot'
  | 'navigate'
  | 'click'
  | 'type'
  | 'press'
  | 'extract'
  | 'list_tabs'
  | 'switch_tab'
  | 'generate_file'
  | 'plan_actions'
  | 'execute_actions';

export type AgentPhase =
  | 'idle'
  | 'working'
  | 'awaiting_approval'
  | 'awaiting_permission'
  | 'awaiting_critical'
  | 'complete'
  | 'error';

export type PendingPermission = {
  host: string;
  url: string;
  // Precomputed here (background) rather than re-derived in the UI, so the page-scope grant the
  // user picks is guaranteed to use the exact same key `matchesAllowlist` checks against.
  pageKey: string;
  reason: string;
};

export type PendingCritical = {
  messageId: string;
};

export type StepResult = {
  action: ScriptStep['action'];
  status: 'ok' | 'error' | 'skipped';
  error?: string;
};

export type ExecutionStatus = 'pending_approval' | 'running' | 'done' | 'rejected' | 'error';

export type ToolActivityStatus = 'pending' | 'ok' | 'error';

export type UIMessage =
  | { id: string; kind: 'user'; text: string; t: number }
  | { id: string; kind: 'assistant'; text: string; tokensIn?: number; tokensOut?: number; turns?: number; elapsed?: number; t: number }
  | {
      id: string;
      kind: 'tool_activity';
      name: ToolName;
      args?: Record<string, unknown>;
      // The result the LLM saw. Kept on the message for live display only — stripped on persist
      // (it lives canonically in the saved conversation) and rehydrated on reopen via `callId`.
      result?: unknown;
      // LLM tool-call id; links this row to its tool_result in the conversation for rehydration.
      callId?: string;
      status: ToolActivityStatus;
      detail?: string;
      thumb?: string;
      t: number;
    }
  | {
      id: string;
      kind: 'plan_proposal';
      goal: string;
      sites?: string[];
      steps: string[];
      script: ScriptStep[];
      explanation?: string;
      t: number;
    }
  | {
      id: string;
      kind: 'execution';
      script: ScriptStep[];
      status: ExecutionStatus;
      rationale?: string;
      results?: StepResult[];
      extractedPreview?: string;
      workingLabel?: string;
      t: number;
    }
  | {
      id: string;
      kind: 'permission_request';
      host: string;
      url: string;
      pageKey: string;
      reason: string;
      status: 'pending' | 'allowed' | 'denied';
      t: number;
    }
  | {
      id: string;
      kind: 'critical_confirm';
      action: 'click' | 'type' | 'press';
      label: string;
      reason: string;
      status: 'pending' | 'confirmed' | 'denied';
      t: number;
    }
  | { id: string; kind: 'error'; text: string; t: number }
  | { id: string; kind: 'file_artifact'; filename: string; content: string; t: number };

export type AgentState = {
  phase: AgentPhase;
  messages: UIMessage[];
  pendingExecution?: { messageId: string };
  pendingPermission?: PendingPermission;
  pendingCritical?: PendingCritical;
  workingLabel?: string;
  errorMsg?: string;
  startedAt?: number;
  // The tab the agent is currently operating on — shown in the side-panel tab card.
  activeTab?: { id: number; title: string; url: string; favIconUrl?: string };
};

export const INITIAL_AGENT_STATE: AgentState = {
  phase: 'idle',
  messages: [],
};

// 'paused' and 'watch' are legacy values kept for backwards-compatible history reads.
export type HistoryStatus = 'running' | 'done' | 'error' | 'stopped' | 'paused' | 'watch';

export type SavedConversationPart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; thoughtSignature?: string }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | { type: 'image_omitted'; mimeType: string };

export type SavedConversationMessage = {
  role: 'user' | 'assistant' | 'tool';
  parts: SavedConversationPart[];
};

export type HistoryItem = {
  id: string;
  startedAt: number;
  endedAt?: number;
  title: string;
  sub: string;
  status: HistoryStatus;
  steps: number;
  durationMs: number;
  state?: AgentState;
  conversation?: SavedConversationMessage[];
};

export type JsonSchemaProp = {
  type: string;
  description?: string;
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  enum?: string[];
};

export type ToolSchema = {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchemaProp>;
    required: string[];
  };
};
