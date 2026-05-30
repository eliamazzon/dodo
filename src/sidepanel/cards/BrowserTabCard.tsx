import type { Palette } from '../../shared/tokens';
import { Ic, Spark } from '../../shared/icons';

// Shows the tab the agent is currently operating on, pinned just above the composer.
// `working` highlights it (with a spark) while the agent is actively driving that tab.
export function BrowserTabCard({
  c, tab, working,
}: {
  c: Palette;
  tab: { title: string; url: string; favIconUrl?: string };
  working: boolean;
}) {
  let host = '';
  try { host = new URL(tab.url).host; } catch { host = tab.url; }
  const label = tab.title?.trim() || host || tab.url;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      margin: '0 12px 8px', padding: '7px 10px', borderRadius: 7,
      background: working ? c.accentBg : c.surface2,
      border: `1px solid ${working ? c.accent : c.border}`,
      minWidth: 0,
    }}>
      {tab.favIconUrl
        ? <img src={tab.favIconUrl} width={15} height={15} style={{ borderRadius: 3, flexShrink: 0 }}/>
        : <Ic.Globe size={15} color={c.muted}/>}
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 12, color: c.ink, fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</span>
      {working
        ? <Spark size={15} color={c.accent} animate={true}/>
        : <span style={{ fontSize: 9.5, color: c.subtle, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>active tab</span>}
    </div>
  );
}
