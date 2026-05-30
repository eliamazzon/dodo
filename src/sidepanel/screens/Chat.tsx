import { useEffect, useRef, useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell } from '../components/PanelShell';
import { PanelHeader, type ModelOption } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg, WorkingLine, NotifyBanner, Thumb } from '../components/atoms';
import { Markdown } from '../components/Markdown';
import { PlanProposalCard } from '../cards/PlanProposalCard';
import { ExecutionCard } from '../cards/ExecutionCard';
import { PermissionCard } from '../cards/PermissionCard';
import { FileArtifactCard } from '../cards/FileArtifactCard';
import type { Mode, AgentState, UIMessage, ToolName } from '../../shared/types';

const toolIcon = (name: ToolName) => {
  switch (name) {
    case 'navigate': return <Ic.Globe size={12}/>;
    case 'screenshot': return <Ic.Camera size={12}/>;
    case 'snapshot': return <Ic.List size={12}/>;
    case 'click': return <Ic.Pointer size={12}/>;
    case 'type': return <Ic.Bolt size={12}/>;
    case 'press': return <Ic.Key size={12}/>;
    case 'extract': return <Ic.Eye size={12}/>;
    default: return <Ic.Stack size={12}/>;
  }
};

function ToolActivityRow({
  c, name, detail, status, thumb, args, result,
}: {
  c: Palette;
  name: ToolName;
  detail?: string;
  status: 'pending' | 'ok' | 'error';
  thumb?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const dot = status === 'error' ? c.error : status === 'ok' ? c.success : c.accent;
  const responseText = result === undefined
    ? null
    : typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '5px 9px', fontSize: 11.5, color: c.muted, cursor: 'pointer',
          background: c.surface2, border: `1px solid ${c.border}`,
          borderRadius: expanded ? '6px 6px 0 0' : 6,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 2, background: dot, flexShrink: 0 }}/>
        <span style={{ color: c.muted, display: 'inline-flex' }}>{toolIcon(name)}</span>
        <span style={{ color: c.ink, fontWeight: 500 }}>{name}</span>
        {detail && <span style={{ flex: 1, color: c.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {detail}</span>}
        {!detail && <span style={{ flex: 1 }}/>}
        {thumb && <Thumb c={c} size={22} base64={thumb}/>}
        <Ic.Chevron size={13} style={{ color: c.muted, flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
      </div>

      {expanded && (
        <div style={{
          border: `1px solid ${c.border}`, borderTop: 'none', borderRadius: '0 0 6px 6px',
          background: c.surface2, padding: '9px 10px',
        }}>
          <ToolDetailBlock c={c} label="call">
            {`${name}(${JSON.stringify(args ?? {}, null, 2)})`}
          </ToolDetailBlock>
          <ToolDetailBlock c={c} label="response" muted={responseText === null}>
            {responseText ?? 'no response yet'}
          </ToolDetailBlock>
        </div>
      )}
    </div>
  );
}

function ToolDetailBlock({ c, label, muted, children }: {
  c: Palette; label: string; muted?: boolean; children: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: c.subtle, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}># {label}</div>
      <pre style={{
        margin: 0, maxHeight: 240, overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.45,
        color: muted ? c.muted : c.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        padding: '7px 9px', borderRadius: 5, background: c.bg, border: `1px dashed ${c.border}`,
      }}>{children}</pre>
    </div>
  );
}

export function Chat({
  c, state, mode, model, providerId, availableModels, onSelectModel,
  onSendMessage, onApproveExecution, onRejectExecution,
  onAllow, onAllowOnce, onDeny,
  onStop, onRetry, onChangeMode, onNewTask,
  onOpenSettings, onOpenHistory,
  showNotifyBanner, onEnableNotify, onDismissNotify,
}: {
  c: Palette;
  state: AgentState;
  mode: Mode;
  model: string;
  providerId: string;
  availableModels: ModelOption[];
  onSelectModel: (id: string) => void;
  onSendMessage: (text: string) => void;
  onApproveExecution: (messageId: string) => void;
  onRejectExecution: (messageId: string) => void;
  onAllow: () => void;
  onAllowOnce: () => void;
  onDeny: () => void;
  onStop: () => void;
  onRetry: () => void;
  onChangeMode: (m: Mode) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  showNotifyBanner: boolean;
  onEnableNotify: () => void;
  onDismissNotify: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.phase, state.workingLabel]);

  const phase = state.phase;
  const composerState: 'active' | 'working' =
    (phase === 'working' || phase === 'awaiting_approval' || phase === 'awaiting_permission') ? 'working' : 'active';

  return (
    <PanelShell c={c}>
      <PanelHeader
        c={c}
        model={model}
        provider={providerId}
        availableModels={availableModels}
        onSelectModel={onSelectModel}
        onNewTask={onNewTask}
        onSettings={onOpenSettings}
        onHistory={onOpenHistory}
      />
      <div ref={scrollRef} style={{
        flex: 1, padding: '14px 14px 0', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {state.messages.map((m) => renderMessage(m, {
          c, onApproveExecution, onRejectExecution, onAllow, onAllowOnce, onDeny,
        }))}

        {phase === 'working' && (
          <WorkingLine c={c} label={state.workingLabel ?? 'thinking'}/>
        )}
        {phase === 'awaiting_approval' && (
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 10 }}>waiting for your approval ↑</div>
        )}
        {phase === 'awaiting_permission' && (
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 10 }}>waiting for permission ↑</div>
        )}
        {phase === 'error' && state.errorMsg && (
          <ErrorBanner c={c} message={state.errorMsg} onRetry={onRetry}/>
        )}
        <div style={{ flex: 1, minHeight: 8 }}/>
      </div>

      {showNotifyBanner && <NotifyBanner c={c} onEnable={onEnableNotify} onClose={onDismissNotify}/>}
      <Composer
        c={c}
        state={composerState}
        mode={mode}
        onChangeMode={onChangeMode}
        onSubmit={onSendMessage}
        onStop={onStop}
        placeholder={state.messages.length > 0 ? 'ask a follow-up…' : 'describe a task…'}
      />
      <Disclaimer c={c}/>
    </PanelShell>
  );
}

function renderMessage(m: UIMessage, props: {
  c: Palette;
  onApproveExecution: (id: string) => void;
  onRejectExecution: (id: string) => void;
  onAllow: () => void;
  onAllowOnce: () => void;
  onDeny: () => void;
}) {
  const { c } = props;
  if (m.kind === 'user') {
    return <UserMsg c={c} key={m.id}>{m.text}</UserMsg>;
  }
  if (m.kind === 'assistant') {
    const hasMeta = m.tokens != null || m.elapsed != null;
    return (
      <div key={m.id} style={{ marginBottom: 16, padding: '2px 0' }}>
        <Markdown text={m.text} style={{ fontSize: 13, lineHeight: 1.55, color: c.ink }}/>
        {hasMeta && (
          <div style={{ display: 'flex', gap: 8, marginTop: 5, fontSize: 10, color: c.subtle, userSelect: 'none' }}>
            {m.tokens != null && <span>{m.tokens >= 1000 ? `${(m.tokens / 1000).toFixed(1)}k` : m.tokens} tokens</span>}
            {m.turns != null && <span>· {m.turns} {m.turns === 1 ? 'turn' : 'turns'}</span>}
            {m.elapsed != null && <span>· {m.elapsed >= 60000 ? `${Math.floor(m.elapsed / 60000)}m ${Math.floor((m.elapsed % 60000) / 1000)}s` : `${(m.elapsed / 1000).toFixed(1)}s`}</span>}
          </div>
        )}
      </div>
    );
  }
  if (m.kind === 'tool_activity') {
    return (
      <ToolActivityRow key={m.id} c={c} name={m.name} detail={m.detail} status={m.status} thumb={m.thumb} args={m.args} result={m.result}/>
    );
  }
  if (m.kind === 'plan_proposal') {
    return (
      <PlanProposalCard
        key={m.id}
        c={c}
        goal={m.goal}
        sites={m.sites}
        steps={m.steps}
        scriptSteps={m.script.length}
        explanation={m.explanation}
      />
    );
  }
  if (m.kind === 'execution') {
    return (
      <ExecutionCard
        key={m.id}
        c={c}
        script={m.script}
        status={m.status}
        rationale={m.rationale}
        results={m.results}
        extractedPreview={m.extractedPreview}
        workingLabel={m.workingLabel}
        onApprove={() => props.onApproveExecution(m.id)}
        onReject={() => props.onRejectExecution(m.id)}
      />
    );
  }
  if (m.kind === 'permission_request') {
    if (m.status !== 'pending') {
      return (
        <div key={m.id} style={{
          fontSize: 11, color: c.muted, marginBottom: 10, padding: '5px 9px',
          background: c.surface2, border: `1px solid ${c.border}`, borderRadius: 6,
        }}>
          permission for {m.host}: {m.status}
        </div>
      );
    }
    return (
      <div key={m.id} style={{ marginBottom: 12 }}>
        <PermissionCard
          c={c}
          host={m.host}
          reason={m.reason}
          onAllow={props.onAllow}
          onAllowOnce={props.onAllowOnce}
          onDeny={props.onDeny}
        />
      </div>
    );
  }
  if (m.kind === 'file_artifact') {
    return <FileArtifactCard key={m.id} c={c} filename={m.filename} content={m.content}/>;
  }
  if (m.kind === 'error') {
    return (
      <div key={m.id} style={{
        marginBottom: 12, padding: '8px 11px',
        background: c.surface2, border: `1px solid ${c.error}`, borderRadius: 6,
        fontSize: 12, color: c.error, lineHeight: 1.45,
      }}>{m.text}</div>
    );
  }
  return null;
}

function ErrorBanner({ c, message, onRetry }: { c: Palette; message: string; onRetry: () => void }) {
  return (
    <div style={{
      padding: '10px 12px', marginBottom: 10,
      background: c.surface2, border: `1px solid ${c.error}`, borderRadius: 6,
      fontSize: 12, color: c.ink, lineHeight: 1.5,
    }}>
      <div style={{ color: c.error, fontWeight: 600, marginBottom: 4 }}>halted</div>
      <div style={{ marginBottom: 8 }}>{message}</div>
      <button onClick={onRetry} style={{
        background: 'transparent', border: `1px solid ${c.border}`, color: c.ink,
        padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11.5,
      }}>retry</button>
    </div>
  );
}
