import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { IcoBtn } from './PanelHeader';
import type { Mode } from '../../shared/types';

const MODE_LABEL: Record<Mode, string> = {
  ask: 'ask before acting',
  auto: 'act on allowlist',
  watch: 'watch only',
};

const COMMANDS: [string, string][] = [
  ['/extract',   'pull structured data from this page'],
  ['/summarize', 'TL;DR the current tab'],
  ['/watch',     'monitor a page for changes'],
  ['/fill',      'autofill a form from your clipboard'],
];

const MODE_OPTIONS: { k: Mode; label: string; desc: string; kbd: string }[] = [
  { k: 'ask',   label: 'ask before acting', desc: 'confirm each action', kbd: '⌘1' },
  { k: 'auto',  label: 'act on allowlist',  desc: 'no prompt for allowed hosts', kbd: '⌘2' },
  { k: 'watch', label: 'watch only',        desc: 'read-only · no actions', kbd: '⌘3' },
];

export function Composer({
  c, placeholder = 'reply to dodo',
  mode = 'ask', onChangeMode,
  state = 'active',
  onSubmit, onStop,
  disabled,
}: {
  c: Palette;
  placeholder?: string;
  mode?: Mode;
  onChangeMode?: (m: Mode) => void;
  state?: 'active' | 'working';
  onSubmit?: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const slashOpen = value.startsWith('/');
  const q = slashOpen ? value.slice(1).toLowerCase() : '';
  const shownCommands = slashOpen ? COMMANDS.filter(([k]) => k.slice(1).startsWith(q)) : COMMANDS;

  const MAX_HEIGHT = 13 * 1.5 * 4; // 4 lines

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSubmit?.(t);
    setValue('');
  };

  return (
    <div style={{ margin: '0 12px 12px' }}>
      {slashOpen && shownCommands.length > 0 && (
        <div style={{
          border: `1px solid ${c.border}`, background: c.surface2,
          borderRadius: 8, padding: 4, marginBottom: 6,
          boxShadow: `0 4px 14px rgba(0,0,0,0.04)`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 8px 6px', fontSize: 10, color: c.subtle, letterSpacing: '0.06em',
          }}>
            <span>commands</span>
            <span>↑↓ · ⏎</span>
          </div>
          {shownCommands.map(([cmd, hint], i) => (
            <div
              key={cmd}
              onClick={() => setValue(cmd + ' ')}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                background: i === 0 ? c.accentBg : 'transparent',
                fontSize: 12,
              }}>
              <span style={{ color: c.accent, minWidth: 84, fontWeight: 600 }}>{cmd}</span>
              <span style={{ color: c.muted, fontSize: 11.5 }}>{hint}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{
        border: `1px solid ${slashOpen ? c.accent : c.border}`,
        background: c.surface2, borderRadius: 8,
        padding: '10px 12px 8px',
        boxShadow: slashOpen ? `0 0 0 3px ${c.accentBg}` : 'none',
        transition: 'box-shadow .15s',
      }}>
        <textarea
          ref={inputRef}
          value={value}
          placeholder={state === 'working' ? 'agent is running — press stop to halt' : placeholder}
          disabled={state === 'working' || disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (state === 'working') onStop?.();
              else submit();
            }
          }}
          rows={1}
          style={{
            width: '100%', resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', fontFamily: DODO_FONT, fontSize: 13,
            color: slashOpen ? c.accent : c.ink, padding: 0,
            lineHeight: 1.5, maxHeight: MAX_HEIGHT, overflowY: 'auto',
            opacity: state === 'working' ? 0.55 : 1,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <button type="button" onClick={() => setModeOpen((v) => !v)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '2px 6px 2px 4px', border: 'none',
            background: modeOpen ? c.bg : 'transparent',
            color: modeOpen ? c.ink : c.muted,
            fontFamily: DODO_FONT, fontSize: 11.5, cursor: 'pointer', borderRadius: 4,
          }}>
            <Ic.Hand size={14}/> {MODE_LABEL[mode]}
            <Ic.Chevron size={11} style={{ transform: modeOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}/>
          </button>
          {modeOpen && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 6px)', left: -4,
              minWidth: 240, background: c.surface2,
              border: `1px solid ${c.border}`, borderRadius: 7,
              boxShadow: `0 10px 24px rgba(0,0,0,0.10), 0 0 0 1px ${c.border}33`,
              padding: 4, zIndex: 5,
            }}>
              {MODE_OPTIONS.map((o) => (
                <div
                  key={o.k}
                  onClick={() => { onChangeMode?.(o.k); setModeOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                    padding: '7px 9px', borderRadius: 4,
                    background: o.k === mode ? c.accentBg : 'transparent',
                  }}>
                  <span style={{
                    width: 13, height: 13, borderRadius: '50%',
                    border: `1.5px solid ${o.k === mode ? c.accent : c.borderHi}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginTop: 1, flexShrink: 0,
                  }}>
                    {o.k === mode && <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.accent }}/>}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: o.k === mode ? c.accentInk : c.ink }}>{o.label}</div>
                    <div style={{ fontSize: 10.5, color: c.muted, marginTop: 1 }}>{o.desc}</div>
                  </div>
                  <span style={{
                    fontSize: 10, color: c.subtle, padding: '1px 5px',
                    border: `1px solid ${c.border}`, borderRadius: 3, flexShrink: 0,
                  }}>{o.kbd}</span>
                </div>
              ))}
              <div style={{
                borderTop: `1px solid ${c.border}`, marginTop: 4, padding: '6px 9px',
                fontSize: 10.5, color: c.subtle,
              }}>changes apply to this task only</div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: c.muted }}>
            <span style={{
              fontSize: 10, color: c.subtle, marginRight: 6,
              padding: '1px 5px', border: `1px solid ${c.border}`, borderRadius: 3,
            }}>/</span>
            {state === 'working'
              ? <IcoBtn c={c} onClick={onStop}><Ic.Stop size={17}/></IcoBtn>
              : <IcoBtn c={c} onClick={submit}><Ic.Send size={15}/></IcoBtn>}
          </div>
        </div>
      </div>
    </div>
  );
}
