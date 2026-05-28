import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';

export type ModelOption = { id: string; label: string };

export function PanelHeader({
  c,
  model = 'gemini-3-flash-preview',
  provider = 'gemini',
  availableModels,
  onSelectModel,
  onNewTask,
  onSettings,
  onHistory,
}: {
  c: Palette;
  model?: string;
  provider?: string;
  availableModels?: ModelOption[];
  onSelectModel?: (id: string) => void;
  onNewTask?: () => void;
  onSettings?: () => void;
  onHistory?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canPick = !!(availableModels && availableModels.length > 0 && onSelectModel);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
      background: c.bg, gap: 8, flexShrink: 0, position: 'relative',
    }}>
      <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
        <button
          type="button"
          onClick={() => canPick && setOpen((v) => !v)}
          disabled={!canPick}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 9px 4px 8px', borderRadius: 5,
            border: `1px solid ${c.border}`, background: c.surface,
            fontSize: 12, minWidth: 0, overflow: 'hidden',
            cursor: canPick ? 'pointer' : 'default',
            color: c.ink,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 1, background: c.accent, flexShrink: 0 }}/>
          <span style={{ color: c.muted, fontSize: 10.5, flexShrink: 0 }}>{provider}/</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
          <Ic.Chevron size={12} style={{
            color: c.muted, marginLeft: 2, flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s',
          }}/>
        </button>
        {open && canPick && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: c.surface, border: `1px solid ${c.border}`, borderRadius: 6,
            boxShadow: `0 6px 24px rgba(0,0,0,0.08)`,
            padding: 4, minWidth: 200, zIndex: 10,
          }}>
            {availableModels!.map((m) => {
              const active = m.id === model;
              return (
                <div
                  key={m.id}
                  onClick={() => { onSelectModel?.(m.id); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 9px', borderRadius: 4, cursor: 'pointer',
                    background: active ? c.accentBg : 'transparent',
                    fontSize: 12, color: c.ink,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: active ? c.accent : 'transparent',
                    border: `1.5px solid ${active ? c.accent : c.muted}`,
                    flexShrink: 0,
                  }}/>
                  <span>{m.label}</span>
                </div>
              );
            })}
          </div>
        )}
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
