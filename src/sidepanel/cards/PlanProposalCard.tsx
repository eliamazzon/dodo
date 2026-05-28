import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';

export function PlanProposalCard({
  c, goal, sites, steps, scriptSteps, explanation,
}: {
  c: Palette;
  goal: string;
  sites?: string[];
  steps: string[];
  scriptSteps: number;
  explanation?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      border: `1px solid ${c.border}`, background: c.surface2,
      borderRadius: 8, padding: '11px 13px', marginBottom: 12,
    }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}
      >
        <Ic.List size={14} style={{ color: c.muted }}/>
        <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>plan drafted</span>
        <span style={{
          fontSize: 10, color: c.muted, background: c.raised, borderRadius: 4, padding: '1px 6px',
        }}>{scriptSteps} steps</span>
        <span style={{ flex: 1 }}/>
        <Ic.Chevron size={14} style={{ color: c.muted, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
          {goal && (
            <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 8, lineHeight: 1.4 }}>
              <span style={{ color: c.subtle }}># goal</span><br/>
              {goal}
            </div>
          )}
          {explanation && (
            <div style={{ fontSize: 11.5, color: c.ink, marginBottom: 10, lineHeight: 1.4 }}>{explanation}</div>
          )}
          {sites && sites.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, color: c.subtle, marginBottom: 5 }}># hosts</div>
              {sites.map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <Ic.Globe size={12} style={{ color: c.muted }}/>
                  <span style={{ fontSize: 11.5, color: c.ink }}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {steps.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, color: c.subtle, marginBottom: 5 }}># steps</div>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, padding: '3px 0' }}>
                  <span style={{
                    flexShrink: 0, width: 16, height: 16, borderRadius: 8,
                    border: `1px solid ${c.borderHi}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9.5, color: c.muted,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 11.5, lineHeight: 1.4, color: c.ink }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
