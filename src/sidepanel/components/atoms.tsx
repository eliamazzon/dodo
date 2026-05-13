import type { ReactNode } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic, Spark } from '../../shared/icons';

export function UserMsg({ c, children }: { c: Palette; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
      <div style={{
        background: c.userBubble, color: c.ink,
        padding: '10px 13px', borderRadius: 8,
        maxWidth: 320, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>{children}</div>
    </div>
  );
}

export function WorkingLine({ c, label = 'working', animate = true }: { c: Palette; label?: string; animate?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <Spark size={20} color={c.accent} animate={animate}/>
      <span style={{ color: c.muted, fontSize: 13 }}>{label}</span>
    </div>
  );
}

export function Thumb({ c, size = 30, base64 }: { c: Palette; size?: number; base64?: string }) {
  if (base64) {
    return (
      <img
        src={`data:image/jpeg;base64,${base64}`}
        width={size} height={size * 0.78}
        style={{ borderRadius: 3, border: `1px solid ${c.border}`, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size * 0.78, borderRadius: 3,
      background: '#fff', border: `1px solid ${c.border}`,
      overflow: 'hidden', flexShrink: 0,
      backgroundImage: `repeating-linear-gradient(0deg, ${c.faint} 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, ${c.border} 0 1px, transparent 1px 5px)`,
      backgroundSize: '100% 60%, 100% 40%',
      backgroundPosition: '0 0, 0 100%',
      backgroundRepeat: 'no-repeat',
    }}/>
  );
}

export function Disclaimer({ c, children }: { c: Palette; children?: ReactNode }) {
  return (
    <div style={{
      textAlign: 'center', fontSize: 10.5, color: c.subtle,
      padding: '0 16px 10px',
    }}>{children || <>dodo runs models you configure. <u style={{ textDecorationColor: c.faint }}>verify outputs</u>.</>}</div>
  );
}

export function NotifyBanner({
  c, onEnable, onClose,
}: { c: Palette; onEnable?: () => void; onClose?: () => void }) {
  return (
    <div style={{
      margin: '0 12px 8px', padding: '10px 12px',
      background: c.userBubble, borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5,
    }}>
      <span style={{ flex: 1, color: c.ink, lineHeight: 1.35 }}>
        get notified when the<br/>agent finishes or needs you
      </span>
      <button type="button" onClick={onEnable} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: c.ink, color: c.bg, border: 'none', borderRadius: 6,
        padding: '6px 10px', fontFamily: DODO_FONT, fontSize: 11.5, cursor: 'pointer',
      }}><Ic.Bell size={13}/> notify me</button>
      <Ic.X size={14} style={{ color: c.muted, cursor: 'pointer' }} onClick={onClose}/>
    </div>
  );
}

export function PrimaryBtn({
  c, children, kbd, full, onClick, disabled,
}: { c: Palette; children: ReactNode; kbd?: string; full?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      width: full ? '100%' : 'auto',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: c.ink, color: c.bg, border: 'none',
      borderRadius: 6, padding: '11px 14px',
      fontFamily: DODO_FONT, fontSize: 13, fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      <span>{children}</span>
      {kbd && <span style={{ opacity: 0.55, fontSize: 11 }}>{kbd}</span>}
    </button>
  );
}

export function GhostBtn({
  c, children, kbd, full, onClick,
}: { c: Palette; children: ReactNode; kbd?: string; full?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: full ? '100%' : 'auto',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: c.surface2, color: c.ink,
      border: `1px solid ${c.border}`,
      borderRadius: 6, padding: '11px 14px',
      fontFamily: DODO_FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    }}>
      <span>{children}</span>
      {kbd && <span style={{ opacity: 0.55, fontSize: 11, color: c.muted }}>{kbd}</span>}
    </button>
  );
}

export function Switch({ c, on, onClick }: { c: Palette; on?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      width: 30, height: 18, borderRadius: 999, cursor: 'pointer',
      background: on ? c.accent : c.faint, position: 'relative',
      transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 14 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.15)',
        transition: 'left .15s',
      }}/>
    </div>
  );
}

export function Toggle3({
  c, value, options, onChange,
}: { c: Palette; value: string; options: string[]; onChange?: (v: string) => void }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 2,
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 5,
    }}>
      {options.map((o) => (
        <span
          key={o}
          onClick={() => onChange?.(o)}
          style={{
            padding: '3px 9px', fontSize: 10.5, borderRadius: 3, cursor: 'pointer',
            background: o === value ? c.surface2 : 'transparent',
            color: o === value ? c.ink : c.muted,
            boxShadow: o === value ? `0 1px 1px rgba(0,0,0,.05)` : 'none',
          }}>{o}</span>
      ))}
    </div>
  );
}
