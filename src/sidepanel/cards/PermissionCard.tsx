import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PrimaryBtn, GhostBtn } from '../components/atoms';

export function PermissionCard({
  c, host, reason, onAllow, onAllowOnce, onDeny,
}: {
  c: Palette;
  host: string;
  reason?: string;
  onAllow?: () => void;
  onAllowOnce?: () => void;
  onDeny?: () => void;
}) {
  return (
    <div style={{
      border: `1.5px solid ${c.accent}`, background: c.surface2,
      borderRadius: 8, padding: '14px 16px',
      boxShadow: `0 6px 24px ${c.accentBg}`,
    }}>
      <div style={{
        fontSize: 10, color: c.accent, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>permission required</div>
      <div style={{ fontSize: 14, color: c.ink, lineHeight: 1.4, marginBottom: 4 }}>
        allow dodo to act on
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12,
        padding: '5px 10px', borderRadius: 5,
        background: c.accentBg, color: c.accentInk, fontSize: 13, fontWeight: 600,
      }}>
        <Ic.Globe size={13}/> {host}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PrimaryBtn c={c} kbd="⏎" full onClick={onAllow}>allow this site</PrimaryBtn>
        <GhostBtn c={c} full onClick={onAllowOnce}>allow once</GhostBtn>
        <button onClick={onDeny} style={{
          background: 'transparent', border: 'none', color: c.muted,
          padding: '7px', fontFamily: DODO_FONT, fontSize: 12, cursor: 'pointer',
        }}>deny</button>
      </div>
    </div>
  );
}
