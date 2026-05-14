import type { CSSProperties, ReactNode } from 'react';

// Renders a small subset of markdown: bold, inline links, ordered/unordered lists.
// Intentionally minimal — handles exactly what the agent summary produces.

const linkStyle = {
  color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2,
  wordBreak: 'break-all' as const, cursor: 'pointer',
};

function openUrl(url: string) {
  chrome.tabs.create({ url });
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match **bold**, [text](url), and bare https?:// URLs in one pass
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] != null) {
      parts.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] != null) {
      const url = m[3];
      parts.push(
        <a key={key++} style={linkStyle} onClick={() => openUrl(url)}>{m[2]}</a>
      );
    } else {
      const url = m[4];
      parts.push(
        <a key={key++} style={linkStyle} onClick={() => openUrl(url)}>{url}</a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text, style }: { text: string; style?: CSSProperties }) {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listType: 'ol' | 'ul' | null = null;
  let listKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listType!;
    nodes.push(
      <Tag key={`list-${listKey++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
        {listItems}
      </Tag>
    );
    listItems = [];
    listType = null;
  };

  lines.forEach((line, i) => {
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    const ulMatch = line.match(/^[-*]\s+(.*)/);

    if (olMatch) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listItems.push(<li key={i}>{renderInline(olMatch[2])}</li>);
    } else if (ulMatch) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listItems.push(<li key={i}>{renderInline(ulMatch[1])}</li>);
    } else {
      flushList();
      if (line.trim()) {
        nodes.push(<p key={i} style={{ margin: '4px 0' }}>{renderInline(line)}</p>);
      } else if (i > 0) {
        nodes.push(<div key={i} style={{ height: 6 }} />);
      }
    }
  });
  flushList();

  return <div style={style}>{nodes}</div>;
}
