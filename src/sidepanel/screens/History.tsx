import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { IcoBtn } from '../components/PanelHeader';
import type { HistoryItem } from '../../shared/types';

const FILTERS = ['all', 'done', 'error', 'watching'] as const;
type Filter = typeof FILTERS[number];

export function History({
  c, items, onClose,
}: {
  c: Palette;
  items: HistoryItem[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const statusColor: Record<HistoryItem['status'], string> = {
    done: c.success, paused: c.warn, error: c.error, watch: c.accent,
  };
  const filtered = items.filter((it) => {
    if (filter === 'all') return true;
    if (filter === 'watching') return it.status === 'watch';
    return it.status === filter;
  });
  return (
    <PanelShell c={c}>
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${c.border}`,
      }}>
        <Ic.ChevronRight
          size={14} style={{ color: c.muted, transform: 'rotate(180deg)', cursor: 'pointer' }}
          onClick={onClose}
        />
        <Ic.Clock size={14} style={{ color: c.muted }}/>
        <span style={{ fontSize: 13, fontWeight: 600 }}>history</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontSize: 10.5, color: c.muted }}>{items.length} tasks</span>
        <IcoBtn c={c}><Ic.Search size={14}/></IcoBtn>
      </div>
      <div style={{
        padding: '6px 14px', borderBottom: `1px solid ${c.border}`,
        display: 'flex', gap: 4, fontSize: 11,
      }}>
        {FILTERS.map((l) => {
          const sel = l === filter;
          return (
            <span
              key={l}
              onClick={() => setFilter(l)}
              style={{
                padding: '3px 9px', borderRadius: 3, cursor: 'pointer',
                background: sel ? c.bg : 'transparent',
                border: `1px solid ${sel ? c.borderHi : 'transparent'}`,
                color: sel ? c.ink : c.muted,
              }}>{l}</span>
          );
        })}
      </div>
      <Body c={c} pad="0">
        {filtered.length === 0 && (
          <div style={{ padding: 24, fontSize: 12, color: c.subtle, textAlign: 'center' }}>
            no tasks yet.
          </div>
        )}
        {filtered.map((it) => (
          <div key={it.id} style={{
            padding: '12px 16px', borderBottom: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: 1, background: statusColor[it.status], flexShrink: 0,
              }}/>
              <span style={{ fontSize: 12.5, color: c.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.title}
              </span>
              <span style={{ fontSize: 10.5, color: c.subtle, flexShrink: 0 }}>{relTime(it.startedAt)}</span>
            </div>
            <div style={{
              display: 'flex', gap: 8, paddingLeft: 14,
              fontSize: 10.5, color: c.muted,
            }}>
              <span>{it.sub}</span>
              <span style={{ color: c.subtle }}>·</span>
              <span>{it.steps} steps</span>
              <span style={{ flex: 1 }}/>
              <span style={{ color: statusColor[it.status] }}>{it.status}</span>
            </div>
          </div>
        ))}
      </Body>
    </PanelShell>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
