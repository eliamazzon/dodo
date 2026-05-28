import { Fragment, useState, useEffect } from 'react';
import { DODO_LIGHT, DODO_FONT } from '../shared/tokens';
import { DodoMark, Ic, Wordmark } from '../shared/icons';
import { PanelShell, Body } from '../sidepanel/components/PanelShell';
import { PrimaryBtn, GhostBtn } from '../sidepanel/components/atoms';
import { GeminiProvider } from '../background/providers/gemini';
import { DEFAULT_SETTINGS, type Settings, type Mode } from '../shared/types';

const DEFAULT_ALLOW = ['*.google.com', '*.github.com', '*.notion.so', '*.wikipedia.org'];

export function Onboarding() {
  const c = DODO_LIGHT;
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [allowlist, setAllowlist] = useState<string[]>(DEFAULT_ALLOW);

  useEffect(() => {
    chrome.storage.local.get(['settings', 'allowlist']).then((raw) => {
      if (raw.settings) setSettings({ ...DEFAULT_SETTINGS, ...raw.settings });
      if (raw.allowlist) setAllowlist(raw.allowlist as string[]);
    });
  }, []);

  const dot = (i: number) => (
    <span style={{
      width: 5, height: 5, borderRadius: 1,
      background: i === step - 1 ? c.accent : c.faint,
    }}/>
  );

  const next = async () => {
    if (step === 4) {
      await chrome.storage.local.set({
        settings: { ...settings, onboarded: true },
        allowlist,
      });
      window.close();
      return;
    }
    setStep(step + 1);
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: c.bg, fontFamily: DODO_FONT,
    }}>
      <PanelShell c={c} w={460} h={720} style={{ borderRadius: 10, border: `1px solid ${c.border}`, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}>
        <div style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 5,
          borderBottom: `1px solid ${c.border}`,
        }}>
          <Wordmark size={13}/>
          <span style={{ flex: 1 }}/>
          {[0,1,2,3].map((i) => <Fragment key={i}>{dot(i)}</Fragment>)}
          <span style={{ flex: 1, maxWidth: 8 }}/>
          <span style={{ fontSize: 10.5, color: c.subtle }}>{step}/4</span>
        </div>
        <Body c={c} pad="24px 28px 0">
          {step === 1 && <Welcome/>}
          {step === 2 && (
            <Provider
              settings={settings}
              onChange={(p) => setSettings({ ...settings, ...p })}
            />
          )}
          {step === 3 && (
            <Sites
              list={allowlist}
              onAdd={(s) => setAllowlist([...allowlist, s])}
              onRemove={(s) => setAllowlist(allowlist.filter((x) => x !== s))}
            />
          )}
          {step === 4 && <Ready settings={settings} allowlist={allowlist}/>}
        </Body>
        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px',
          borderTop: `1px solid ${c.border}`,
        }}>
          {step > 1 && <GhostBtn c={c} onClick={back}>back</GhostBtn>}
          <span style={{ flex: 1 }}/>
          <PrimaryBtn c={c} kbd="⏎" onClick={next}>{step === 4 ? 'start' : 'continue'}</PrimaryBtn>
        </div>
      </PanelShell>
    </div>
  );
}

function Welcome() {
  const c = DODO_LIGHT;
  return (
    <div>
      <div style={{
        width: 56, height: 56, borderRadius: 10,
        border: `1.5px solid ${c.accent}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 18, color: c.accent,
      }}>
        <DodoMark size={34} color={c.accent}/>
      </div>
      <h2 style={{
        fontFamily: DODO_FONT, fontSize: 20, fontWeight: 600,
        margin: '0 0 10px', lineHeight: 1.3, letterSpacing: '-0.01em',
      }}>welcome to dodo.</h2>
      <p style={{ fontSize: 13, color: c.muted, lineHeight: 1.6, margin: 0 }}>
        an open-source browser agent powered by gemini. point it at a task, watch it work in your current tab, stop it anytime.
      </p>
      <div style={{
        marginTop: 22, padding: '12px 14px',
        border: `1px dashed ${c.border}`, borderRadius: 6,
        background: c.surface, fontSize: 12, color: c.muted, lineHeight: 1.55,
      }}>
        <span style={{ color: c.subtle }}># note</span><br/>
        dodo only sees pages you've explicitly allowed. your api key stays on this machine.
      </div>
    </div>
  );
}

function Provider({
  settings, onChange,
}: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const c = DODO_LIGHT;
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const verify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    const r = await GeminiProvider.verifyKey(settings.apiKey);
    setVerifying(false);
    setVerifyMsg({ ok: r.ok, text: r.ok ? 'key verified · models reachable' : r.error ?? 'verification failed' });
  };

  return (
    <div>
      <div style={{ fontSize: 10.5, color: c.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>step 1 of 3</div>
      <h2 style={{ fontFamily: DODO_FONT, fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>
        choose your provider
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        <div style={{
          padding: '10px 12px', borderRadius: 6,
          border: `1px solid ${c.accent}`,
          background: c.accentBg,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: 3,
            border: `1.5px solid ${c.accent}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ width: 6, height: 6, background: c.accent, borderRadius: 1 }}/>
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>google · gemini</div>
            <div style={{ fontSize: 10.5, color: c.muted, marginTop: 2 }}>gemini-3-flash-preview · bring your own api key</div>
          </div>
        </div>
        <div style={{
          padding: '10px 12px', borderRadius: 6,
          border: `1px dashed ${c.border}`,
          background: c.surface,
          fontSize: 11.5, color: c.subtle,
        }}>
          more providers coming soon · anthropic · openai · ollama
        </div>
      </div>

      <div style={{ fontSize: 12, color: c.ink, marginBottom: 6 }}>your gemini api key</div>
      <input
        type="text"
        value={settings.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder="AIza…"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '9px 11px',
          fontFamily: DODO_FONT, fontSize: 12, borderRadius: 5,
          border: `1px solid ${c.border}`, background: c.surface2, color: c.ink,
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <button onClick={verify} disabled={!settings.apiKey || verifying} style={{
          padding: '6px 12px', borderRadius: 4, border: `1px solid ${c.border}`,
          background: c.surface2, color: c.ink, fontFamily: DODO_FONT, fontSize: 11.5,
          cursor: settings.apiKey && !verifying ? 'pointer' : 'default',
          opacity: settings.apiKey && !verifying ? 1 : 0.5,
        }}>{verifying ? 'verifying…' : 'verify key'}</button>
        {verifyMsg && (
          <span style={{ fontSize: 11, color: verifyMsg.ok ? c.success : c.error }}>
            {verifyMsg.text}
          </span>
        )}
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: c.muted, lineHeight: 1.55 }}>
        get a free key at <span style={{ color: c.accent }}>aistudio.google.com/apikey</span>.
      </div>
    </div>
  );
}

function Sites({
  list, onAdd, onRemove,
}: { list: string[]; onAdd: (s: string) => void; onRemove: (s: string) => void }) {
  const c = DODO_LIGHT;
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div style={{ fontSize: 10.5, color: c.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>step 2 of 3</div>
      <h2 style={{ fontFamily: DODO_FONT, fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>
        starting allowlist
      </h2>
      <p style={{ fontSize: 12, color: c.muted, margin: '0 0 16px', lineHeight: 1.55 }}>
        dodo can only touch sites you've allowed. you can change this at any time.
      </p>
      <div style={{
        border: `1px solid ${c.border}`, borderRadius: 6, background: c.surface2, padding: 4,
      }}>
        {list.map((s) => (
          <div key={s} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
            borderRadius: 4, fontSize: 12.5,
          }}>
            <Ic.Globe size={13} style={{ color: c.muted }}/>
            <span style={{ flex: 1 }}>{s}</span>
            <Ic.X size={12} style={{ color: c.subtle, cursor: 'pointer' }} onClick={() => onRemove(s)}/>
          </div>
        ))}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          fontSize: 12.5, color: c.subtle, borderTop: list.length ? `1px solid ${c.border}` : 'none', marginTop: 4,
        }}>
          <Ic.Plus size={13}/>
          <input
            value={draft}
            placeholder="add domain or pattern…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onAdd(draft.trim());
                setDraft('');
              }
            }}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: DODO_FONT, fontSize: 12.5, color: c.ink,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Ready({ settings, allowlist }: { settings: Settings; allowlist: string[] }) {
  const c = DODO_LIGHT;
  const mode: Mode = settings.defaultMode;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: c.success, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>$ ready</div>
      <h2 style={{ fontFamily: DODO_FONT, fontSize: 20, fontWeight: 600, margin: '0 0 14px' }}>
        you're set.
      </h2>
      <div style={{
        background: c.surface2, border: `1px solid ${c.border}`, borderRadius: 6,
        padding: '12px 14px', fontSize: 12, lineHeight: 1.7,
      }}>
        <div><span style={{ color: c.muted }}>provider </span><span style={{ color: c.accent }}>gemini</span></div>
        <div><span style={{ color: c.muted }}>model    </span>{settings.model}</div>
        <div><span style={{ color: c.muted }}>hosts    </span>{allowlist.length} allowed</div>
        <div><span style={{ color: c.muted }}>mode     </span>{mode === 'ask' ? 'ask before acting' : mode === 'auto' ? 'act on allowlist' : 'watch only'}</div>
      </div>
      <p style={{ fontSize: 12, color: c.muted, margin: '14px 0 0', lineHeight: 1.55 }}>
        pin dodo to your toolbar to open it from any tab. press{' '}
        <kbd style={{ background: c.surface, border: `1px solid ${c.border}`, padding: '0 4px', borderRadius: 3, fontFamily: DODO_FONT, fontSize: 10.5 }}>⌘⇧D</kbd>
        {' '}to summon it anywhere.
      </p>
    </div>
  );
}
