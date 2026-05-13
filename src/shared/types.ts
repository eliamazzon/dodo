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

export type HistoryItem = {
  id: string;
  startedAt: number;
  title: string;
  sub: string;
  status: 'done' | 'error' | 'paused' | 'watch';
  steps: number;
  durationMs: number;
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
