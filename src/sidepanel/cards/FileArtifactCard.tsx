import { Ic } from '../../shared/icons';
import type { Palette } from '../../shared/tokens';

function mimeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (ext === '.md')   return 'text/markdown';
  if (ext === '.csv')  return 'text/csv';
  if (ext === '.json') return 'application/json';
  return 'text/plain';
}

export function FileArtifactCard({ c, filename, content }: {
  c: Palette;
  filename: string;
  content: string;
}) {
  function download() {
    const blob = new Blob([content], { type: mimeFor(filename) });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '5px 9px', marginBottom: 8,
      background: c.surface2, border: `1px solid ${c.border}`, borderRadius: 6,
      fontSize: 11.5,
    }}>
      <span style={{ color: c.muted, display: 'inline-flex' }}><Ic.File size={12}/></span>
      <span style={{ flex: 1, color: c.ink, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {filename}
      </span>
      <button
        onClick={download}
        style={{
          background: 'transparent', border: `1px solid ${c.border}`,
          color: c.muted, padding: '3px 8px', borderRadius: 4,
          fontSize: 11, cursor: 'pointer', flexShrink: 0,
        }}
      >
        download
      </button>
    </div>
  );
}
