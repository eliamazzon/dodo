import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { Switch, Toggle3 } from '../components/atoms';
import { SettingRow } from '../cards/SettingRow';
import type { Settings as SettingsT, Mode } from '../../shared/types';
import { saveSettingsDirect } from '../hooks/useAgent';

export function Settings({
  c, settings, onClose, onTestNotify,
}: {
  c: Palette;
  settings: SettingsT;
  onClose: () => void;
  onTestNotify: () => void;
}) {
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(settings.apiKey);

  const update = (patch: Partial<SettingsT>) => { void saveSettingsDirect(patch); };

  const maskedKey = settings.apiKey
    ? `${settings.apiKey.slice(0, 4)}${'•'.repeat(Math.max(8, settings.apiKey.length - 8))}${settings.apiKey.slice(-4)}`
    : 'not set';

  return (
    <PanelShell c={c}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
      }}>
        <Ic.ChevronRight
          size={14} style={{ color: c.muted, transform: 'rotate(180deg)', cursor: 'pointer' }}
          onClick={onClose}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>settings</span>
        <span style={{ flex: 1 }}/>
        <Ic.X size={14} style={{ color: c.muted, cursor: 'pointer' }} onClick={onClose}/>
      </div>
      <Body c={c} pad="0">
        <Section c={c}>model</Section>
        <SettingRow c={c}
          label="provider"
          value="google · gemini api"
          action={<Ic.Chevron size={13} style={{ color: c.muted, transform: 'rotate(-90deg)' }}/>}
        />
        <SettingRow c={c}
          label="default model"
          value={settings.model}
          action={<Ic.Chevron size={13} style={{ color: c.muted, transform: 'rotate(-90deg)' }}/>}
        />

        <Section c={c}>byok</Section>
        {editingKey ? (
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 12.5, color: c.ink, marginBottom: 8 }}>gemini api key</div>
            <input
              type="text"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                fontFamily: DODO_FONT, fontSize: 12, borderRadius: 5,
                border: `1px solid ${c.border}`, background: c.surface2, color: c.ink,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => { update({ apiKey: keyDraft }); setEditingKey(false); }} style={{
                padding: '5px 10px', borderRadius: 4, border: 'none',
                background: c.ink, color: c.bg, fontFamily: DODO_FONT, fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}>save</button>
              <button onClick={() => { setKeyDraft(settings.apiKey); setEditingKey(false); }} style={{
                padding: '5px 10px', borderRadius: 4, border: `1px solid ${c.border}`,
                background: 'transparent', color: c.muted, fontFamily: DODO_FONT, fontSize: 11, cursor: 'pointer',
              }}>cancel</button>
            </div>
          </div>
        ) : (
          <SettingRow c={c}
            label="api key"
            value={maskedKey}
            hint="stored locally · never sent anywhere but google"
            action={<button onClick={() => { setKeyDraft(settings.apiKey); setEditingKey(true); }} style={{
              padding: '4px 8px', fontSize: 11, fontFamily: DODO_FONT, cursor: 'pointer',
              background: c.surface, border: `1px solid ${c.border}`,
              color: c.muted, borderRadius: 4,
            }}>edit</button>}
          />
        )}

        <Section c={c}>notifications</Section>
        <SettingRow c={c}
          label="notify when done"
          hint="ping me when the agent finishes or needs my input"
          action={<Switch c={c} on={settings.notifyEnabled} onClick={() => {
            const next = !settings.notifyEnabled;
            update({ notifyEnabled: next, notifyDismissed: next ? settings.notifyDismissed : false });
          }}/>}
        />
        <SettingRow c={c}
          label="send a test notification"
          action={<button onClick={onTestNotify} style={{
            padding: '4px 8px', fontSize: 11, fontFamily: DODO_FONT, cursor: 'pointer',
            background: c.surface, border: `1px solid ${c.border}`,
            color: c.muted, borderRadius: 4,
          }}>test</button>}
        />

        <Section c={c}>behavior</Section>
        <SettingRow c={c}
          label="default mode"
          action={<Toggle3
            c={c}
            value={settings.defaultMode}
            options={['ask','auto','watch']}
            onChange={(v) => update({ defaultMode: v as Mode })}
          />}
        />
        <SettingRow c={c}
          label="confirm before navigation"
          action={<Switch c={c} on={settings.confirmNavigation} onClick={() => update({ confirmNavigation: !settings.confirmNavigation })}/>}
        />
        <SettingRow c={c}
          label="screenshot redaction"
          action={<Switch c={c} on={settings.screenshotRedaction} onClick={() => update({ screenshotRedaction: !settings.screenshotRedaction })}/>}
        />
        <SettingRow c={c}
          label="telemetry"
          hint="off by default. dodo never phones home."
          action={<Switch c={c} on={settings.telemetry} onClick={() => update({ telemetry: !settings.telemetry })}/>}
        />
      </Body>
    </PanelShell>
  );
}

function Section({ c, children }: { c: Palette; children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: c.subtle, letterSpacing: '0.08em',
      textTransform: 'uppercase', padding: '14px 16px 6px',
    }}>{children}</div>
  );
}
