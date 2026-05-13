import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg } from '../components/atoms';
import type { Mode, CompleteSummary } from '../../shared/types';

export function Complete({
  c, task, model, mode, complete, steps,
  onChangeMode, onSubmit, onNewTask, onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  mode: Mode;
  complete: CompleteSummary;
  steps: number;
  onChangeMode: (m: Mode) => void;
  onSubmit: (text: string) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  const dur = formatDuration(complete.durationMs);
  const priColor: Record<string, string> = { p0: c.error, p1: c.warn, p2: c.muted };
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: c.success }}>
          <Ic.CheckCircle size={18}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>done</span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 10.5, color: c.muted }}>{dur} · {steps} actions</span>
        </div>

        <div style={{
          padding: '12px 14px', border: `1px solid ${c.border}`,
          background: c.surface2, borderRadius: 8, marginBottom: 10,
        }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}># summary</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: c.ink, whiteSpace: 'pre-wrap' }}>
            {complete.summary}
          </div>
        </div>

        {complete.actionItems.length > 0 && (
          <div style={{
            padding: '12px 14px', border: `1px solid ${c.border}`,
            background: c.surface2, borderRadius: 8,
          }}>
            <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}># action items</div>
            {complete.actionItems.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 2,
                  background: c.bg, border: `1px solid ${c.border}`, color: priColor[it.priority],
                  flexShrink: 0, marginTop: 2,
                }}>{it.priority}</span>
                <span style={{ color: c.ink, lineHeight: 1.45 }}>{it.text}</span>
              </div>
            ))}
          </div>
        )}
      </Body>
      <Composer c={c} placeholder="ask a follow-up…" mode={mode} onChangeMode={onChangeMode} onSubmit={onSubmit}/>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
