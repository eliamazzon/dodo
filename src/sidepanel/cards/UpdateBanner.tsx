import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { BUILD } from '../../shared/build';
import type { UpdateInfo } from '../../shared/types';

// DODO runs unpacked from a git checkout, so applying an update is: pull + rebuild on disk, then
// reload the extension so Chrome re-reads dist/. The extension can't run the first half itself
// (MV3 has no shell), so the banner hands over the exact command — including the user's real
// checkout path, stamped in at build time — and then offers the reload once they've run it.
export function UpdateBanner({
  c, info, onApply, onDismiss,
}: {
  c: Palette;
  info: UpdateInfo;
  onApply: () => void;
  onDismiss: (sha: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const command = `cd ${BUILD.repoPath} && npm run update`;
  const count = info.aheadBy;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard can be refused; expanding at least makes the command selectable by hand.
      setExpanded(true);
    }
  };

  return (
    <div style={{
      margin: '0 12px 8px', padding: '10px 12px',
      background: c.userBubble, borderRadius: 8, fontSize: 11.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Ic.Refresh size={13} style={{ color: c.accent, flexShrink: 0 }}/>
        <span style={{ flex: 1, color: c.ink, lineHeight: 1.35 }}>
          update available
          <span style={{ color: c.muted }}>
            {' · '}{count} new commit{count === 1 ? '' : 's'}
          </span>
        </span>
        {info.notes.length > 0 && (
          <Ic.Chevron
            size={14}
            style={{
              color: c.muted, cursor: 'pointer', flexShrink: 0,
              transform: expanded ? 'rotate(180deg)' : undefined,
            }}
            onClick={() => setExpanded((e) => !e)}
          />
        )}
        <Ic.X
          size={14}
          style={{ color: c.muted, cursor: 'pointer', flexShrink: 0 }}
          onClick={() => onDismiss(info.latestSha)}
        />
      </div>

      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 23 }}>
          <ul style={{ margin: 0, padding: '0 0 0 14px', color: c.muted, lineHeight: 1.5 }}>
            {info.notes.map((n, i) => <li key={i}>{n}</li>)}
            {count > info.notes.length && (
              <li style={{ listStyle: 'none', marginLeft: -14, opacity: 0.7 }}>
                …and {count - info.notes.length} more
              </li>
            )}
          </ul>
          <div style={{
            marginTop: 8, padding: '6px 8px', background: c.surface2,
            border: `1px solid ${c.border}`, borderRadius: 6,
            fontSize: 10.5, color: c.muted, userSelect: 'text',
            overflowX: 'auto', whiteSpace: 'nowrap',
          }}>
            {command}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <button type="button" onClick={copy} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: copied ? 'transparent' : c.ink,
          color: copied ? c.muted : c.bg,
          border: copied ? `1px solid ${c.border}` : 'none',
          borderRadius: 6, padding: '6px 10px',
          fontFamily: DODO_FONT, fontSize: 11.5, cursor: 'pointer',
        }}>
          {copied ? <><Ic.Check size={13}/> copied — run it</> : <>copy update command</>}
        </button>
        <button type="button" onClick={onApply} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: copied ? c.ink : 'transparent',
          color: copied ? c.bg : c.muted,
          border: copied ? 'none' : `1px solid ${c.border}`,
          borderRadius: 6, padding: '6px 10px',
          fontFamily: DODO_FONT, fontSize: 11.5, cursor: 'pointer',
        }}>
          reload DODO
        </button>
      </div>
    </div>
  );
}
