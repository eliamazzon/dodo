import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PrimaryBtn, GhostBtn } from '../components/atoms';
import type { PermissionScope, PermissionDuration, AccessLevel } from '../../shared/types';
import { domainPatternOf } from '../../shared/permissions';

// Short, readable version of the page path for display (host + truncated path, no scheme).
function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname === '/' ? '' : u.pathname;
    const s = u.host + p;
    return s.length > 42 ? s.slice(0, 41) + '…' : s;
  } catch {
    return url;
  }
}

export function PermissionCard({
  c, host, url, pageKey, reason, access, onDecide, onDeny,
}: {
  c: Palette;
  host: string;
  url: string;
  // Computed by the background (see PendingPermission.pageKey) so the pattern picked here matches
  // exactly what `matchesAllowlist` checks against — no risk of the UI's derivation drifting from it.
  pageKey: string;
  reason?: string;
  // What the grant allows — 'read' in plan mode, 'act' (read + click/type) otherwise.
  access: AccessLevel;
  onDecide?: (pattern: string, scope: PermissionScope, duration: PermissionDuration, access: AccessLevel) => void;
  onDeny?: () => void;
}) {
  // Default to the narrower "this page" scope; the user can widen to the whole domain deliberately.
  const [scope, setScope] = useState<PermissionScope>('page');
  const pattern = scope === 'page' ? pageKey : domainPatternOf(host);
  const target = scope === 'page' ? prettyPath(url) : host;
  const decide = (duration: PermissionDuration) => onDecide?.(pattern, scope, duration, access);

  const tab = (s: PermissionScope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(s)}
      style={{
        flex: 1, padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
        border: `1px solid ${scope === s ? c.accent : c.border}`,
        background: scope === s ? c.accentBg : 'transparent',
        color: scope === s ? c.accentInk : c.muted,
        fontFamily: DODO_FONT, fontSize: 11.5, fontWeight: 600,
      }}
    >{label}</button>
  );

  return (
    <div style={{
      border: `1.5px solid ${c.accent}`, background: c.surface2,
      borderRadius: 8, padding: '14px 16px',
      boxShadow: `0 6px 24px ${c.accentBg}`,
    }}>
      <div style={{
        fontSize: 10, color: c.accent, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>{access === 'read' ? 'read access required' : 'permission required'}</div>
      <div style={{ fontSize: 14, color: c.ink, lineHeight: 1.4, marginBottom: 4 }}>
        {access === 'read' ? 'allow dodo to read' : 'allow dodo to act on'}
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8,
        padding: '5px 10px', borderRadius: 5,
        background: c.accentBg, color: c.accentInk, fontSize: 13, fontWeight: 600,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <Ic.Globe size={13}/> {target}
      </div>
      <div style={{ fontSize: 11, color: c.muted, lineHeight: 1.45, marginBottom: 12 }}>
        {access === 'read'
          ? 'read-only — dodo can view and navigate here, never click or type'
          : 'dodo can read, click and type here'}
      </div>
      {reason && (
        <div style={{
          fontSize: 11.5, color: c.muted, lineHeight: 1.5,
          padding: '8px 10px', borderRadius: 5,
          background: c.bg, border: `1px dashed ${c.border}`,
          marginBottom: 12,
        }}>
          <span style={{ color: c.subtle }}># why</span><br/>
          {reason}
        </div>
      )}

      <div style={{ fontSize: 10, color: c.subtle, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>scope</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {tab('page', 'this page')}
        {tab('domain', 'whole domain')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PrimaryBtn c={c} kbd="⏎" full onClick={() => decide('always')}>always allow</PrimaryBtn>
        <GhostBtn c={c} full onClick={() => decide('session')}>allow until dodo finishes</GhostBtn>
        <GhostBtn c={c} full onClick={() => decide('once')}>allow once</GhostBtn>
        <button onClick={onDeny} style={{
          background: 'transparent', border: 'none', color: c.muted,
          padding: '7px', fontFamily: DODO_FONT, fontSize: 12, cursor: 'pointer',
        }}>deny</button>
      </div>
    </div>
  );
}
