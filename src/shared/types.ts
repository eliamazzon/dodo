// 'ask' requires user approval before each navigation; 'auto' runs fully autonomously; 'watch' observes without acting.
export type Mode = 'ask' | 'auto' | 'watch';

export type Settings = {
  providerId: string;
  apiKey: string;
  model: string;
  defaultMode: Mode;
  confirmNavigation: boolean;
  screenshotRedaction: boolean;
  telemetry: boolean;
  notifyEnabled: boolean;
  notifyDismissed: boolean;
  onboarded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  providerId: 'gemini',
  apiKey: '',
  model: 'gemini-3.1-flash-lite',
  defaultMode: 'ask',
  confirmNavigation: true,
  screenshotRedaction: true,
  telemetry: false,
  notifyEnabled: false,
  notifyDismissed: false,
  onboarded: false,
};

export type Plan = {
  sites: string[];
  steps: string[];
  script?: ScriptStep[];
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
  | { action: 'extract'; description?: string }
  | { action: 'done'; summary: string };

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

export type ToolName = 'navigate' | 'screenshot' | 'snapshot' | 'click' | 'type' | 'extract' | 'done';

export type ToolCallRecord = {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  status: 'pending' | 'ok' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: unknown;
  errorMsg?: string;
  label?: string;
  detail?: string;
  thumb?: string;
};

/**
 * State machine:
 * idle → planning → awaiting_approval → working → complete | error
 *                                         └→ awaiting_permission → working | error
 */
export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'working'
  | 'awaiting_permission'
  | 'complete'
  | 'error';

export type CompleteSummary = {
  summary: string;
  actionItems: { priority: 'p0' | 'p1' | 'p2'; text: string }[];
  durationMs: number;
  steps: number;
};

export type PendingPermission = {
  host: string;
  reason: string;
};

export type AgentState = {
  phase: AgentPhase;
  task?: string;
  plan?: Plan;
  toolCalls: ToolCallRecord[];
  workingLabel?: string;
  pendingPermission?: PendingPermission;
  errorMsg?: string;
  complete?: CompleteSummary;
  startedAt?: number;
};

export const INITIAL_AGENT_STATE: AgentState = {
  phase: 'idle',
  toolCalls: [],
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
