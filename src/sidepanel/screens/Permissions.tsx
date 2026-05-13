import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Disclaimer, UserMsg, WorkingLine } from '../components/atoms';
import { PermissionCard } from '../cards/PermissionCard';
import type { PendingPermission } from '../../shared/types';

export function Permissions({
  c, task, model, pending, onAllow, onAllowOnce, onDeny, onNewTask,
  onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  pending: PendingPermission;
  onAllow: () => void;
  onAllowOnce: () => void;
  onDeny: () => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <WorkingLine c={c} label="waiting for permission" animate={false}/>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, color: c.muted,
        }}>
          <Ic.Pointer size={16}/>
          <span style={{ fontSize: 13 }}>navigate to {pending.host}</span>
        </div>
        <PermissionCard
          c={c}
          host={pending.host}
          reason={pending.reason}
          onAllow={onAllow}
          onAllowOnce={onAllowOnce}
          onDeny={onDeny}
        />
      </Body>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
