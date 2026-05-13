import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { UserMsg, WorkingLine } from '../components/atoms';
import { PlanCard } from '../cards/PlanCard';
import type { Plan } from '../../shared/types';

export function PlanApproval({
  c, task, model, plan, onApprove, onEdit, onNewTask,
  onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  plan: Plan;
  onApprove: () => void;
  onEdit: () => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <WorkingLine c={c} label="working" animate={false}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, color: c.muted }}>
          <Ic.List size={16}/>
          <span style={{ fontSize: 13 }}>drafted plan</span>
        </div>
        <PlanCard c={c} sites={plan.sites} steps={plan.steps} onApprove={onApprove} onEdit={onEdit}/>
      </Body>
    </PanelShell>
  );
}
