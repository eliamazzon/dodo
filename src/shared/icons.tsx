import type { CSSProperties, ReactNode, SVGProps } from 'react';
import { DODO_FONT } from './tokens';

type IconProps = { size?: number; style?: CSSProperties } & SVGProps<SVGSVGElement>;

const make = (path: ReactNode, vb = 24) =>
  ({ size = 16, style, ...rest }: IconProps) => (
    <svg
      width={size} height={size} viewBox={`0 0 ${vb} ${vb}`}
      fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" style={style} {...rest}
    >
      {path}
    </svg>
  );

export const Ic = {
  Plus: make(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>),
  X: make(<><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></>),
  Check: make(<polyline points="5 12 10 17 19 7"/>),
  CheckCircle: make(<><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></>),
  XCircle: make(<><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></>),
  Chevron: make(<polyline points="6 9 12 15 18 9"/>),
  ChevronUp: make(<polyline points="6 15 12 9 18 15"/>),
  ChevronRight: make(<polyline points="9 6 15 12 9 18"/>),
  Kebab: make(<><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>),
  Bolt: make(<polyline points="13 3 4 14 11 14 10 21 19 10 12 10 13 3"/>),
  Chat: make(<><path d="M4 5h16v11H9l-4 4z"/><line x1="12" y1="11" x2="12" y2="11"/></>),
  Globe: make(<><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></>),
  Pointer: make(<path d="M5 4l4.5 14 2-6 6-2z"/>),
  Camera: make(<><rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8 6l1.5-2h5L16 6"/></>),
  Cog: make(<><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></>),
  List: make(<><circle cx="5.5" cy="6" r="1.2"/><circle cx="5.5" cy="12" r="1.2"/><circle cx="5.5" cy="18" r="1.2"/><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/></>),
  Stack: make(<><rect x="6" y="3" width="13" height="13" rx="2"/><path d="M16 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3"/></>),
  Stop: make(<><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/></>),
  Bell: make(<><path d="M6 10a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/></>),
  Send: make(<><line x1="20" y1="4" x2="4" y2="12"/><polyline points="4 12 10 14 12 20 20 4"/></>),
  Hand: make(<><path d="M8 11V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1c-2 0-3-1-4-2l-3-4a1.5 1.5 0 0 1 2.4-1.7L8 13"/><path d="M8 11V8.5a1.5 1.5 0 0 0-3 0V13"/></>),
  Search: make(<><circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="15.5" y2="15.5"/></>),
  Clock: make(<><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></>),
  Eye: make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>),
  Key: make(<><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><line x1="17" y1="6" x2="20" y2="9"/><line x1="14" y1="9" x2="17" y2="12"/></>),
  Refresh: make(<><polyline points="3 4 3 10 9 10"/><path d="M3 10a9 9 0 0 1 16-2"/><polyline points="21 20 21 14 15 14"/><path d="M21 14a9 9 0 0 1-16 2"/></>),
  File: make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>),
};

export function Spark({ size = 18, color = 'currentColor', animate = true }: { size?: number; color?: string; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <g style={animate ? { transformOrigin: 'center', animation: 'dodo-spin 2.4s linear infinite' } : undefined}>
        <rect x="10" y="2"  width="4" height="4" fill={color}/>
        <rect x="18" y="10" width="4" height="4" fill={color}/>
        <rect x="10" y="18" width="4" height="4" fill={color}/>
        <rect x="2"  y="10" width="4" height="4" fill={color}/>
      </g>
      <rect x="9" y="9" width="6" height="6" fill="none" stroke={color} strokeWidth={1.5}/>
    </svg>
  );
}

export function Wordmark({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <span style={{
      fontFamily: DODO_FONT, fontSize: size, fontWeight: 600,
      letterSpacing: '-0.01em', color,
    }}>
      dodo<span style={{ opacity: 0.45 }}>://</span>
    </span>
  );
}

export function DodoMark({ size = 32, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 32 32" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M5 19 Q5 11 14 11 Q22 11 22 18 Q22 25 13 25 Q5 25 5 19 Z"/>
      <path d="M19 12 Q19 7 23 7 Q26 7 26 11"/>
      <path d="M26 10 L29 12 Q30.5 13.5 28.5 14 L25.5 13"/>
      <circle cx="23.2" cy="9.5" r="0.8" fill={color}/>
      <path d="M5 18 Q2.5 16 3.5 14"/>
    </svg>
  );
}
