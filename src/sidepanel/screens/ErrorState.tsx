import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer, UserMsg, WorkingLine } from '../components/atoms';
import { ToolCard } from '../cards/ToolCard';
import type { Mode, ToolCallRecord } from '../../shared/types';

export function ErrorState({
  c, task, model, mode, calls, errorMsg,
  onRetry, onReset, onChangeMode, onSubmit, onNewTask, onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  task: string;
  model: string;
  mode: Mode;
  calls: ToolCallRecord[];
  errorMsg: string;
  onRetry: () => void;
  onReset: () => void;
  onChangeMode: (m: Mode) => void;
  onSubmit: (text: string) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} model={model} onNewTask={onNewTask} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c}>
        <UserMsg c={c}>{task}</UserMsg>
        <WorkingLine c={c} label="halted" animate={false}/>
        {calls.length > 0 && (
          <ToolCard c={c} title={`${calls.length} actions`} calls={calls} status="error"/>
        )}
        <div style={{
          marginTop: 14, padding: '10px 12px',
          background: c.errorBg, border: `1px solid ${c.error}33`,
          borderRadius: 6, fontSize: 11.5, color: c.error, lineHeight: 1.5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Ic.XCircle size={13}/>
            <span style={{ fontWeight: 600 }}>execution halted</span>
          </div>
          <div style={{ color: c.ink, opacity: 0.85 }}>{errorMsg}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={onRetry} style={{
              padding: '5px 10px', borderRadius: 4, border: `1px solid ${c.error}55`,
              background: c.surface2, color: c.error, fontFamily: DODO_FONT, fontSize: 11, cursor: 'pointer',
            }}>↻ retry</button>
            <button onClick={onReset} style={{
              padding: '5px 10px', borderRadius: 4, border: `1px solid ${c.border}`,
              background: 'transparent', color: c.muted, fontFamily: DODO_FONT, fontSize: 11, cursor: 'pointer',
            }}>new task</button>
          </div>
        </div>
      </Body>
      <Composer c={c} mode={mode} onChangeMode={onChangeMode} onSubmit={onSubmit}/>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
