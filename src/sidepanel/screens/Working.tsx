import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg, WorkingLine, NotifyBanner } from '../components/atoms';
import { ToolCard } from '../cards/ToolCard';
import type { Mode, ToolCallRecord } from '../../shared/types';

export function Working({
  c, task, model, mode, calls, workingLabel, startedAt,
  notifyEnabled, onEnableNotify, onDismissNotify,
  onStop, onChangeMode, onSubmit, onNewTask, onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  mode: Mode;
  calls: ToolCallRecord[];
  workingLabel?: string;
  startedAt?: number;
  notifyEnabled: boolean;
  onEnableNotify: () => void;
  onDismissNotify: () => void;
  onStop: () => void;
  onChangeMode: (m: Mode) => void;
  onSubmit: (text: string) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  const elapsed = startedAt ? Date.now() - startedAt : undefined;
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <WorkingLine c={c} label={workingLabel || 'working'}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, color: c.muted }}>
          <Ic.List size={16}/>
          <span style={{ fontSize: 13 }}>plan approved</span>
        </div>
        {calls.length > 0 && (
          <ToolCard
            c={c}
            title={`step ${calls.length} · ${workingLabel ?? 'in progress'}`}
            calls={calls}
            elapsedMs={elapsed}
            status="working"
          />
        )}
      </Body>
      {!notifyEnabled && <NotifyBanner c={c} onEnable={onEnableNotify} onClose={onDismissNotify}/>}
      <Composer c={c} state="working" mode={mode} onChangeMode={onChangeMode} onSubmit={onSubmit} onStop={onStop}/>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
