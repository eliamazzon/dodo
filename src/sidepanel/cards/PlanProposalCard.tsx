import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PrimaryBtn } from '../components/atoms';
import type { Mode, PlanBulk, PlanStatus, PlanStepStatus } from '../../shared/types';

type RunMode = Exclude<Mode, 'plan'>;

const STATUS_LABEL: Record<PlanStatus, string> = {
  pending: 'awaiting approval',
  approved: 'approved',
  rejected: 'rejected',
  superseded: 'replaced',
};

// A plan proposed from read & plan mode. Pending → the user picks the act mode to run it in and
// approves (granting act on the listed sites for that run) or rejects; to revise, they just reply.
// Approved → a live checklist driven by update_plan. Legacy entries (no status) render read-only.
export function PlanProposalCard({
  c, goal, sites, steps, bulk, status, stepStatus, defaultRunMode, onApprove, onReject,
}: {
  c: Palette;
  goal: string;
  sites?: string[];
  steps: string[];
  bulk?: PlanBulk;
  status?: PlanStatus;
  stepStatus?: PlanStepStatus[];
  defaultRunMode: RunMode;
  onApprove?: (mode: RunMode) => void;
  onReject?: () => void;
}) {
  const isPending = status === 'pending';
  const [expanded, setExpanded] = useState(isPending || status === 'approved');
  const [runMode, setRunMode] = useState<RunMode>(defaultRunMode);
  const open = expanded || isPending;
  const doneCount = stepStatus?.filter((s) => s !== 'todo').length ?? 0;

  const modeTab = (m: RunMode, label: string) => (
    <button
      type="button"
      onClick={() => setRunMode(m)}
      style={{
        flex: 1, padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
        border: `1px solid ${runMode === m ? c.accent : c.border}`,
        background: runMode === m ? c.accentBg : 'transparent',
        color: runMode === m ? c.accentInk : c.muted,
        fontFamily: DODO_FONT, fontSize: 11.5, fontWeight: 600,
      }}
    >{label}</button>
  );

  const stepDot = (s: PlanStepStatus | undefined, i: number) => {
    const color = s === 'done' ? c.success : s === 'failed' ? c.error : s === 'skipped' ? c.muted : c.borderHi;
    return (
      <span style={{
        flexShrink: 0, width: 16, height: 16, borderRadius: 8,
        border: `1px solid ${color}`, background: s === 'done' ? c.success : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9.5, color: s === 'done' ? c.surface2 : c.muted,
      }}>{s === 'done' ? '✓' : s === 'skipped' ? '–' : s === 'failed' ? '✕' : i + 1}</span>
    );
  };

  return (
    <div style={{
      border: isPending ? `1.5px solid ${c.accent}` : `1px solid ${c.border}`,
      background: c.surface2, borderRadius: 8, padding: isPending ? '14px 16px' : '11px 13px', marginBottom: 12,
      boxShadow: isPending ? `0 6px 24px ${c.accentBg}` : 'none',
      opacity: status === 'superseded' || status === 'rejected' ? 0.65 : 1,
    }}>
      <div
        onClick={() => { if (!isPending) setExpanded((e) => !e); }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: isPending ? 'default' : 'pointer' }}
      >
        <Ic.List size={14} style={{ color: isPending ? c.accent : c.muted }}/>
        <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>{isPending ? 'proposed plan' : 'plan'}</span>
        <span style={{
          fontSize: 10, color: c.muted, background: c.raised, borderRadius: 4, padding: '1px 6px',
        }}>{status === 'approved' && stepStatus ? `${doneCount}/${steps.length} steps` : `${steps.length} steps`}</span>
        {status && !isPending && <span style={{ fontSize: 10, color: c.subtle }}>{STATUS_LABEL[status]}</span>}
        <span style={{ flex: 1 }}/>
        {!isPending && <Ic.Chevron size={14} style={{ color: c.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>}
      </div>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
          {goal && (
            <div style={{ fontSize: 12.5, color: c.ink, marginBottom: 10, lineHeight: 1.45 }}>{goal}</div>
          )}
          {steps.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, color: c.subtle, marginBottom: 5 }}># steps</div>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, padding: '3px 0' }}>
                  {stepDot(stepStatus?.[i], i)}
                  <span style={{
                    fontSize: 11.5, lineHeight: 1.4, color: stepStatus?.[i] === 'skipped' ? c.muted : c.ink,
                    textDecoration: stepStatus?.[i] === 'skipped' ? 'line-through' : 'none',
                  }}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {bulk && (
            <div style={{
              marginBottom: 10, fontSize: 11.5, color: c.muted, lineHeight: 1.5,
              padding: '7px 9px', borderRadius: 5, background: c.bg, border: `1px dashed ${c.border}`,
            }}>
              <span style={{ color: c.subtle, fontSize: 10.5 }}># bulk · {bulk.items.length} items</span><br/>
              {bulk.description}
              <div style={{ marginTop: 4, maxHeight: 96, overflowY: 'auto', color: c.ink }}>
                {bulk.items.map((it, i) => <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {it}</div>)}
              </div>
            </div>
          )}
          {sites && sites.length > 0 && (
            <div style={{ marginBottom: isPending ? 12 : 0 }}>
              <div style={{ fontSize: 10.5, color: c.subtle, marginBottom: 5 }}>
                # sites{isPending ? ' · approving lets dodo act here until it finishes' : ''}
              </div>
              {sites.map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <Ic.Globe size={12} style={{ color: c.muted }}/>
                  <span style={{ fontSize: 11.5, color: c.ink }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isPending && (
        <>
          <div style={{ fontSize: 10, color: c.subtle, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>run in</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {modeTab('ask', 'ask before acting')}
            {modeTab('auto', 'act on allowlist')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PrimaryBtn c={c} full onClick={() => onApprove?.(runMode)}>approve & run</PrimaryBtn>
            <button onClick={onReject} style={{
              background: 'transparent', border: 'none', color: c.muted,
              padding: '7px', fontFamily: DODO_FONT, fontSize: 12, cursor: 'pointer',
            }}>reject</button>
            <div style={{ fontSize: 10.5, color: c.subtle, textAlign: 'center' }}>or reply below to change the plan</div>
          </div>
        </>
      )}
    </div>
  );
}
