import type { Palette } from '../../shared/tokens';
import type { ToolCallRecord } from '../../shared/types';
import { Ic } from '../../shared/icons';
import { Thumb } from '../components/atoms';

const iconFor = (name: string) => {
  switch (name) {
    case 'navigate': return <Ic.Pointer size={13}/>;
    case 'screenshot': return <Ic.Camera size={13}/>;
    case 'snapshot': return <Ic.List size={13}/>;
    case 'click': return <Ic.Pointer size={13}/>;
    case 'type': return <Ic.Bolt size={13}/>;
    case 'extract': return <Ic.Eye size={13}/>;
    default: return <Ic.Stack size={13}/>;
  }
};

export function ToolCard({
  c, title, calls, elapsedMs, status,
}: {
  c: Palette;
  title: string;
  calls: ToolCallRecord[];
  elapsedMs?: number;
  status: 'ok' | 'error' | 'working';
}) {
  return (
    <div style={{
      border: `1px solid ${c.border}`, background: c.surface2,
      borderRadius: 8, padding: '12px 14px', marginBottom: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, fontSize: 12,
      }}>
        <span style={{ color: c.muted }}>{title}</span>
        {elapsedMs != null && (
          <span style={{ color: c.subtle, fontSize: 10.5 }}>{(elapsedMs / 1000).toFixed(1)}s elapsed</span>
        )}
      </div>
      <div style={{ position: 'relative', paddingLeft: 18 }}>
        <div style={{
          position: 'absolute', left: 5, top: 4, bottom: 4, width: 1,
          background: c.border,
        }}/>
        {calls.map((a, i) => {
          const last = i === calls.length - 1;
          const dotColor = a.status === 'error'
            ? c.error
            : (last && status === 'working' ? c.accent : c.success);
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, position: 'relative' }}>
              <span style={{
                position: 'absolute', left: -18, top: 3,
                width: 11, height: 11, borderRadius: 2, background: dotColor,
                boxShadow: `0 0 0 3px ${c.surface2}`,
              }}/>
              <span style={{ color: c.muted, marginTop: 1 }}>{iconFor(a.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  color: a.status === 'error' ? c.error : c.ink,
                  lineHeight: 1.4,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{a.label ?? a.name}</div>
                {a.detail && (
                  <div style={{ fontSize: 10.5, color: c.subtle, marginTop: 2 }}>{a.detail}</div>
                )}
              </div>
              {a.name === 'screenshot' && a.status === 'ok' && a.thumb && (
                <Thumb c={c} size={26} base64={a.thumb}/>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
