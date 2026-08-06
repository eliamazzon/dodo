import type { Palette } from '../../shared/tokens';
import { DODO_FONT } from '../../shared/tokens';
import { Wordmark } from '../../shared/icons';
import { PanelShell, Body } from '../components/PanelShell';
import { PanelHeader } from '../components/PanelHeader';
import { PrimaryBtn, Disclaimer } from '../components/atoms';

export function RequireApiKey({
  c, onOpenSettings, onOpenHistory,
}: {
  c: Palette;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <PanelShell c={c}>
      <PanelHeader c={c} onSettings={onOpenSettings} onHistory={onOpenHistory}/>
      <Body c={c} pad="0">
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
            dodo needs an api key before it can work.<br/>
            add your gemini api key to get started.
          </div>
          <div style={{ marginTop: 22, width: '100%' }}>
            <PrimaryBtn c={c} full onClick={onOpenSettings}>add api key</PrimaryBtn>
          </div>
        </div>
      </Body>
      <Disclaimer c={c}/>
    </PanelShell>
  );
}
