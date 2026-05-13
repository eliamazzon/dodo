import type { ReactNode } from 'react';
import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';

export function PanelHeader({
  c,
  model = 'gemini-3.1-flash-lite',
  provider = 'gemini',
  onNewTask,
  onSettings,
  onHistory,
}: {
  c: Palette;
  model?: string;
  provider?: string;
  onNewTask?: () => void;
  onSettings?: () => void;
  onHistory?: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
      background: c.bg, gap: 8, flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 9px 4px 8px', borderRadius: 5,
        border: `1px solid ${c.border}`, background: c.surface,
        fontSize: 12, minWidth: 0, overflow: 'hidden',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 1, background: c.accent, flexShrink: 0 }}/>
        <span style={{ color: c.muted, fontSize: 10.5, flexShrink: 0 }}>{provider}/</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
        <Ic.Chevron size={12} style={{ color: c.muted, marginLeft: 2, flexShrink: 0 }}/>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: c.muted, flexShrink: 0 }}>
        <IcoBtn c={c} onClick={onNewTask}><Ic.Plus size={15}/></IcoBtn>
        <IcoBtn c={c} onClick={onHistory}><Ic.Clock size={15}/></IcoBtn>
        <IcoBtn c={c} onClick={onSettings}><Ic.Cog size={15}/></IcoBtn>
      </div>
    </div>
  );
}

export function IcoBtn({ c, children, onClick }: { c: Palette; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick?.(); }}
      style={{
        width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', borderRadius: 5,
        color: c.muted, cursor: 'pointer',
      }}
    >{children}</button>
  );
}
