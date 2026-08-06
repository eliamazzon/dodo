import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PrimaryBtn } from '../components/atoms';

// Extra human-in-the-loop confirmation for a checkout/payment-shaped action the local guardrail
// flagged. Warning-styled (amber accent) to stand apart from the routine permission prompt.
export function CriticalConfirmCard({
  c, action, label, reason, status, onConfirm, onDeny,
}: {
  c: Palette;
  action: 'click' | 'type' | 'press';
  label: string;
  reason: string;
  status: 'pending' | 'confirmed' | 'denied';
  onConfirm?: () => void;
  onDeny?: () => void;
}) {
  const isPending = status === 'pending';
  const verb = action === 'click' ? 'click' : action === 'type' ? 'fill' : 'submit';

  return (
    <div style={{
      border: `1.5px solid ${c.warn}`, background: c.surface2,
      borderRadius: 8, padding: '14px 16px', marginBottom: 12,
      boxShadow: isPending ? `0 6px 24px ${c.errorBg}` : 'none',
      opacity: isPending ? 1 : 0.7,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        fontSize: 10, color: c.warn, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>
        <Ic.Stop size={13}/> sensitive action
      </div>
      <div style={{ fontSize: 14, color: c.ink, lineHeight: 1.4, marginBottom: 8 }}>
        dodo wants to {verb}
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12,
        padding: '5px 10px', borderRadius: 5,
        background: c.errorBg, color: c.ink, fontSize: 13, fontWeight: 600,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {action === 'click' ? <Ic.Pointer size={13}/> : <Ic.Key size={13}/>} {label}
      </div>
      <div style={{
        fontSize: 11.5, color: c.muted, lineHeight: 1.5,
        padding: '8px 10px', borderRadius: 5,
        background: c.bg, border: `1px dashed ${c.border}`,
        marginBottom: isPending ? 12 : 0,
      }}>
        <span style={{ color: c.subtle }}># why you're being asked</span><br/>
        {reason}. confirm only if you want dodo to proceed.
      </div>

      {isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PrimaryBtn c={c} kbd="⏎" full onClick={onConfirm}>confirm action</PrimaryBtn>
          <button onClick={onDeny} style={{
            background: 'transparent', border: 'none', color: c.muted,
            padding: '7px', fontFamily: DODO_FONT, fontSize: 12, cursor: 'pointer',
          }}>cancel</button>
        </div>
      )}
      {!isPending && (
        <div style={{ fontSize: 11, color: status === 'confirmed' ? c.success : c.muted, marginTop: 10 }}>
          {status === 'confirmed' ? '✓ confirmed' : '✕ cancelled'}
        </div>
      )}
    </div>
  );
}
