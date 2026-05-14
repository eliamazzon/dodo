import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PrimaryBtn, GhostBtn } from '../components/atoms';

export function PlanCard({
  c, sites, steps, scriptSteps, onApprove, onEdit,
}: {
  c: Palette;
  sites: string[];
  steps: string[];
  scriptSteps?: number;
  onApprove?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div style={{
      border: `1px solid ${c.border}`, background: c.surface2,
      borderRadius: 8, padding: '12px 14px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Ic.List size={16} style={{ color: c.muted }}/>
        <span style={{ fontWeight: 600, fontSize: 13 }}>plan.draft</span>
        {scriptSteps != null && (
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, color: c.muted,
            background: c.raised, borderRadius: 4, padding: '2px 6px',
          }}>{scriptSteps}-step script</span>
        )}
      </div>
      {sites.length > 0 && (
        <div style={{ borderTop: `1px solid ${c.border}`, paddingTop: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 6 }}># allowed hosts</div>
          {sites.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <Ic.Globe size={14} style={{ color: c.muted }}/>
              <span style={{ fontSize: 12.5 }}>{s}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}># steps</div>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '5px 0' }}>
            <span style={{
              flexShrink: 0, width: 20, height: 20, borderRadius: 10,
              border: `1px solid ${c.borderHi}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: c.muted,
            }}>{i + 1}</span>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: c.ink }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PrimaryBtn c={c} kbd="⏎" full onClick={onApprove}>approve plan</PrimaryBtn>
        <GhostBtn c={c} kbd="⌘ ⏎" full onClick={onEdit}>edit plan</GhostBtn>
      </div>
      <div style={{ fontSize: 10.5, color: c.subtle, marginTop: 12, lineHeight: 1.45 }}>
        dodo will only touch the hosts above. you'll be asked again before anything else.
      </div>
    </div>
  );
}
