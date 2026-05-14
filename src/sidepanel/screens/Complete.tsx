import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg } from '../components/atoms';
import { Markdown } from '../components/Markdown';
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
          <Markdown text={complete.summary} style={{ fontSize: 13, lineHeight: 1.55, color: c.ink }}/>
        </div>

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
