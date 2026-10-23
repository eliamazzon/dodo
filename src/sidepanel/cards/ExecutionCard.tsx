import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import type { ScriptStep, StepResult, ExecutionStatus } from '../../shared/types';
import { PrimaryBtn } from '../components/atoms';

function summarizeStep(step: ScriptStep): string {
  if (step.action === 'navigate') return `navigate ${step.url}`;
  if (step.action === 'snapshot') return 'snapshot page';
  if (step.action === 'click') return `click ${step.description || step.target?.text || step.target?.aria || 'element'}`;
  if (step.action === 'type') return `type "${step.text}"${step.target?.placeholder ? ` into ${step.target.placeholder}` : ''}`;
  if (step.action === 'press') return `press ${step.key}${step.target?.text || step.target?.aria ? ` on ${step.target.text || step.target.aria}` : ''}`;
  if (step.action === 'extract') return 'extract page text';
  if (step.action === 'foreach') return `for each of ${step.items?.length ?? 0} items × ${step.steps?.length ?? 0} steps`;
  return (step as { action: string }).action;
}

const statusColor = (c: Palette, s: ExecutionStatus): string => {
  if (s === 'done') return c.success;
  if (s === 'error') return c.error;
  if (s === 'rejected') return c.muted;
  if (s === 'pending_approval') return c.accent;
  return c.accent; // running
};

const statusLabel = (s: ExecutionStatus): string => {
  if (s === 'pending_approval') return 'awaiting approval';
  if (s === 'running') return 'running';
  if (s === 'done') return 'done';
  if (s === 'error') return 'error';
  if (s === 'rejected') return 'rejected';
  return s;
};

export function ExecutionCard({
  c, script, expandedCount, status, rationale, results, extractedPreview, workingLabel,
  onApprove, onReject,
}: {
  c: Palette;
  script: ScriptStep[];
  expandedCount?: number;
  status: ExecutionStatus;
  rationale?: string;
  results?: StepResult[];
  extractedPreview?: string;
  workingLabel?: string;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const [expanded, setExpanded] = useState(status === 'pending_approval' || status === 'running');
  const isPending = status === 'pending_approval';
  const color = statusColor(c, status);
  const runningIdx = results?.length ?? -1;
  // `results` index into the foreach-expanded steps. Without a foreach they line up 1:1 with the
  // script rows (per-row dots); with one, show the script as written plus an overall progress line.
  const total = expandedCount ?? script.length;
  const perRow = !script.some((s) => s.action === 'foreach');
  const okCount = results?.filter((r) => r.status === 'ok').length ?? 0;
  const lastError = results?.find((r) => r.status === 'error')?.error;

  return (
    <div style={{
      border: isPending ? `1.5px solid ${c.accent}` : `1px solid ${c.border}`,
      background: c.surface2, borderRadius: 8,
      padding: '12px 14px', marginBottom: 12,
      boxShadow: isPending ? `0 6px 24px ${c.accentBg}` : 'none',
    }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      >
        <Ic.Bolt size={14} style={{ color }}/>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>execute script</span>
        <span style={{
          fontSize: 10, color, background: c.raised, borderRadius: 4, padding: '1px 6px',
          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>{statusLabel(status)}</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontSize: 10.5, color: c.muted }}>{!perRow && results?.length ? `${okCount}/` : ''}{total} steps</span>
        <Ic.Chevron size={14} style={{ color: c.muted, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
          {rationale && (
            <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 10, lineHeight: 1.45 }}>{rationale}</div>
          )}
          <div style={{ position: 'relative', paddingLeft: 16 }}>
            <div style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: 1, background: c.border }}/>
            {script.map((step, i) => {
              const stepResult = perRow ? results?.[i] : undefined;
              const isRunning = perRow && status === 'running' && i === runningIdx;
              const dotColor = stepResult?.status === 'error' ? c.error
                : stepResult?.status === 'ok' || (!perRow && status === 'done') ? c.success
                : isRunning ? c.accent
                : c.faint;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 7, position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: -16, top: 4,
                    width: 9, height: 9, borderRadius: 2, background: dotColor,
                    boxShadow: `0 0 0 3px ${c.surface2}`,
                  }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: stepResult?.status === 'error' ? c.error : c.ink, lineHeight: 1.4 }}>{summarizeStep(step)}</div>
                    {step.action === 'foreach' && (
                      <div style={{ marginTop: 3, paddingLeft: 8, borderLeft: `1px solid ${c.border}` }}>
                        {(step.steps ?? []).map((s, j) => (
                          <div key={j} style={{ fontSize: 11, color: c.muted, lineHeight: 1.45 }}>{summarizeStep(s)}</div>
                        ))}
                      </div>
                    )}
                    {stepResult?.error && (
                      <div style={{ fontSize: 10.5, color: c.error, marginTop: 1 }}>{stepResult.error}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!perRow && (status === 'running' || status === 'done' || status === 'error') && (
            <div style={{ fontSize: 10.5, color: c.muted, marginTop: 4 }}>
              {okCount}/{total} steps done
              {lastError && <div style={{ color: c.error, marginTop: 2 }}>{lastError}</div>}
            </div>
          )}

          {workingLabel && status === 'running' && (
            <div style={{ fontSize: 10.5, color: c.muted, marginTop: 8 }}>running: {workingLabel}</div>
          )}

          {extractedPreview && (
            <div style={{
              marginTop: 10, fontSize: 11, color: c.muted, lineHeight: 1.5,
              padding: '7px 9px', borderRadius: 5, background: c.bg, border: `1px dashed ${c.border}`,
              whiteSpace: 'pre-wrap',
            }}>
              <span style={{ color: c.subtle, fontSize: 10 }}># extracted (preview)</span><br/>
              {extractedPreview}
            </div>
          )}
        </div>
      )}

      {isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          <PrimaryBtn c={c} kbd="⏎" full onClick={onApprove}>approve & run</PrimaryBtn>
          <button onClick={onReject} style={{
            background: 'transparent', border: 'none', color: c.muted,
            padding: '7px', fontFamily: DODO_FONT, fontSize: 12, cursor: 'pointer',
          }}>reject</button>
        </div>
      )}
    </div>
  );
}
