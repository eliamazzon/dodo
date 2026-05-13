import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg, WorkingLine } from '../components/atoms';
import type { Mode } from '../../shared/types';

export function PlanCreating({
  c, task, model, mode, onStop, onChangeMode, onNewTask,
  onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  mode: Mode;
  onStop: () => void;
  onChangeMode: (m: Mode) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <WorkingLine c={c} label="working"/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: c.subtle, padding: '4px 0' }}>
          <Ic.List size={16}/>
          <span style={{ fontSize: 13 }}>drafting plan…</span>
        </div>
      </Body>
      <Composer c={c} state="working" mode={mode} onChangeMode={onChangeMode} onStop={onStop}/>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
