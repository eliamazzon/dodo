import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Wordmark } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader, type ModelOption } from '../components/PanelHeader';
import { Composer } from '../components/Composer';
import { Disclaimer } from '../components/atoms';
import { UpdateBanner } from '../cards/UpdateBanner';
import type { Mode, UpdateInfo } from '../../shared/types';

const SAMPLES = [
  'extract every job posting on this page',
  'find a flight to lisbon under €200',
  'reply to my unread github mentions',
  'collect all comments on this doc',
];

export function Empty({
  c, mode, model, providerId, availableModels, onSelectModel,
  onSubmit, onChangeMode, onNewTask, onOpenSettings, onOpenHistory,
  update, onApplyUpdate, onDismissUpdate,
}: {
  c: Palette;
  mode: Mode;
  model: string;
  providerId: string;
  availableModels: ModelOption[];
  onSelectModel: (id: string) => void;
  onSubmit: (text: string) => void;
  onChangeMode: (m: Mode) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  update: UpdateInfo | null;
  onApplyUpdate: () => void;
  onDismissUpdate: (sha: string) => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader
        c={c}
        model={model}
        provider={providerId}
        availableModels={availableModels}
        onSelectModel={onSelectModel}
        onNewTask={onNewTask}
        onSettings={onOpenSettings}
        onHistory={onOpenHistory}
      />
      <Body c={c} pad="0">
        {update && (
          <div style={{ paddingTop: 10 }}>
            <UpdateBanner c={c} info={update} onApply={onApplyUpdate} onDismiss={onDismissUpdate}/>
          </div>
        )}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'flex-start', justifyContent: 'center',
          padding: '0 22px',
        }}>
          <Wordmark size={22}/>
          <div style={{
            fontFamily: DODO_FONT, fontSize: 13, color: c.muted,
            marginTop: 10, lineHeight: 1.55,
          }}>
            open-source browser agent.<br/>
            tell it what to do, watch it work,<br/>
            stop it anytime.
          </div>
          <div style={{ marginTop: 28, width: '100%' }}>
            <div style={{
              fontSize: 10, color: c.subtle, textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 10,
            }}>try</div>
            {SAMPLES.map((s) => (
              <div
                key={s}
                onClick={() => onSubmit(s)}
                style={{
                  padding: '9px 12px', marginBottom: 6,
                  background: c.surface2, border: `1px solid ${c.border}`,
                  borderRadius: 6, fontSize: 12.5, color: c.ink, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                <span style={{ color: c.accent }}>›</span>
                <span style={{ flex: 1 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </Body>
      <Composer c={c} placeholder="describe a task…" mode={mode} onChangeMode={onChangeMode} onSubmit={onSubmit}/>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
