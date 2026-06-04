import type { CSSProperties, ReactNode } from 'react';
import { DODO_FONT, type Palette } from '../../shared/tokens';

type Props = {
  c: Palette;
  dark?: boolean;
  w?: number | string;
  h?: number | string;
  children: ReactNode;
  style?: CSSProperties;
};

export function PanelShell({
  c, dark, w = '100%', h = '100%', children, style,
}: Props) {
  return (
    <div style={{
      width: w, height: h, boxSizing: 'border-box',
      background: c.bg, color: c.ink,
      fontFamily: DODO_FONT, fontSize: 13, lineHeight: 1.5,
      display: 'flex', flexDirection: 'column',
      colorScheme: dark ? 'dark' : 'light',
      overflow: 'hidden', position: 'relative',
      ...style,
    }}>
      {children}
    </div>
  );
}

export function Body({ c: _c, children, pad = '14px 14px 0' }: { c: Palette; children: ReactNode; pad?: string }) {
  return (
    <div style={{
      flex: 1, padding: pad, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
}
