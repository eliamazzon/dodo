import type { ReactNode } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';

export function SettingRow({
  c, label, value, hint, action,
}: {
  c: Palette;
  label: string;
  value?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${c.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: c.ink }}>{label}</span>
        {action}
      </div>
      {value && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 4, fontFamily: DODO_FONT, wordBreak: 'break-all' }}>{value}</div>}
      {hint && <div style={{ fontSize: 10.5, color: c.subtle, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}
