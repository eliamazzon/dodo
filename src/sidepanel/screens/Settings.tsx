import { useState } from 'react';
import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Ic } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { Switch, Toggle3 } from '../components/atoms';
import { SettingRow } from '../cards/SettingRow';
import type { Settings as SettingsT, Mode, ApprovalMode } from '../../shared/types';
import { getProvider, pickBestModel } from '../../background/providers';
import type { ModelOption } from '../components/PanelHeader';

export function Settings({
  c, settings, onUpdate, onClose, onTestNotify,
  models, modelsLoading, modelsError, onRefreshModels,
}: {
  c: Palette;
  settings: SettingsT;
  onUpdate: (patch: Partial<SettingsT>) => void;
  onClose: () => void;
  onTestNotify: () => void;
  models: ModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  onRefreshModels: () => void;
}) {
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(settings.apiKey);
  const [pickingModel, setPickingModel] = useState(false);
  const [keyChecking, setKeyChecking] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  const provider = getProvider(settings.providerId);

  const update = onUpdate;

  const saveKey = async () => {
    const newKey = keyDraft;
    const prevModel = settings.model;
    update({ apiKey: newKey });
    setEditingKey(false);
    setKeyMsg(null);
    if (!newKey.trim()) return;
    setKeyChecking(true);
    const r = await provider.verifyKey(newKey);
    setKeyChecking(false);
    if (r.ok && r.supportedModels && !r.supportedModels.includes(prevModel)) {
      const best = pickBestModel(provider, r.supportedModels);
      update({ model: best });
      setKeyMsg(`switched default model to ${best} — your key doesn't support ${prevModel}`);
    }
  };

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
        {pickingModel ? (
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${c.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: c.ink }}>default model</span>
              <span
                onClick={modelsLoading ? undefined : onRefreshModels}
                style={{ fontSize: 11, color: c.muted, cursor: modelsLoading ? 'default' : 'pointer' }}
              >{modelsLoading ? 'fetching models…' : 'refresh list'}</span>
            </div>
            {modelsError && (
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}>
                couldn't fetch models from your key, showing the built-in list · {modelsError}
              </div>
            )}
            {models.map((m) => (
              <div
                key={m.id}
                onClick={() => { update({ model: m.id }); setPickingModel(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', marginBottom: 4, borderRadius: 5, cursor: 'pointer',
                  background: m.id === settings.model ? c.accentBg : c.surface2,
                  border: `1px solid ${m.id === settings.model ? c.accent : c.border}`,
                  fontSize: 12,
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 5,
                  background: m.id === settings.model ? c.accent : 'transparent',
                  border: `1.5px solid ${m.id === settings.model ? c.accent : c.muted}`,
                  flexShrink: 0,
                }}/>
                <span style={{ flex: 1, color: c.ink }}>{m.label}</span>
              </div>
            ))}
            <button onClick={() => setPickingModel(false)} style={{
              marginTop: 4, padding: '5px 10px', borderRadius: 4, border: `1px solid ${c.border}`,
              background: 'transparent', color: c.muted, fontFamily: DODO_FONT, fontSize: 11, cursor: 'pointer',
            }}>cancel</button>
          </div>
        ) : (
          <SettingRow c={c}
            label="default model"
            value={settings.model}
            action={<button onClick={() => setPickingModel(true)} style={{
              padding: '4px 8px', fontSize: 11, fontFamily: DODO_FONT, cursor: 'pointer',
              background: c.surface, border: `1px solid ${c.border}`,
              color: c.muted, borderRadius: 4,
            }}>change</button>}
          />
        )}

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
              <button onClick={saveKey} disabled={keyChecking} style={{
                padding: '5px 10px', borderRadius: 4, border: 'none',
                background: c.ink, color: c.bg, fontFamily: DODO_FONT, fontSize: 11, cursor: keyChecking ? 'default' : 'pointer', fontWeight: 600,
                opacity: keyChecking ? 0.6 : 1,
              }}>{keyChecking ? 'checking…' : 'save'}</button>
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
        {keyMsg && (
          <div style={{ padding: '0 16px 10px', fontSize: 11, color: c.muted, lineHeight: 1.5 }}>{keyMsg}</div>
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
            options={['ask','auto','plan']}
            onChange={(v) => update({ defaultMode: v as Mode })}
          />}
        />
        <SettingRow c={c}
          label="script approval"
          hint="ask before running bulk-action scripts, or auto-accept"
          action={<Toggle3
            c={c}
            value={settings.approvalMode === 'always_ask' ? 'ask' : 'auto'}
            options={['ask','auto']}
            onChange={(v) => update({ approvalMode: (v === 'ask' ? 'always_ask' : 'auto_accept') as ApprovalMode })}
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
          label="on-page cursor & action pill"
          hint="show the gliding cursor and tool pill overlay while the agent clicks/types on the page"
          action={<Switch c={c} on={settings.showCursorOverlay} onClick={() => update({ showCursorOverlay: !settings.showCursorOverlay })}/>}
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
