import { useState } from 'react';
import { DODO_LIGHT } from '../shared/tokens';
import { useAgent, saveSettingsDirect } from './hooks/useAgent';
import { Empty } from './screens/Empty';
import { Chat } from './screens/Chat';
import { Settings } from './screens/Settings';
import { History } from './screens/History';
import { getProvider } from '../background/providers';

type View = 'agent' | 'settings' | 'history';

export function App() {
  const c = DODO_LIGHT;
  const [view, setView] = useState<View>('agent');
  const a = useAgent();
  const { snap } = a;

  if (view === 'settings') {
    return <Settings c={c} settings={snap.settings} onClose={() => setView('agent')} onTestNotify={a.testNotify}/>;
  }
  if (view === 'history') {
    return (
      <History
        c={c}
        items={snap.history}
        onClose={() => setView('agent')}
        onOpen={(id) => { a.openHistory(id); setView('agent'); }}
        onDelete={(id) => a.deleteHistory(id)}
      />
    );
  }

  const provider = getProvider(snap.settings.providerId);
  const common = {
    model: snap.settings.model,
    mode: snap.settings.defaultMode,
    providerId: snap.settings.providerId,
    availableModels: provider.availableModels,
    onSelectModel: (id: string) => { void saveSettingsDirect({ model: id }); },
    onChangeMode: a.setMode,
    onNewTask: a.reset,
    onOpenSettings: () => setView('settings'),
    onOpenHistory: () => setView('history'),
  };

  const phase = snap.state.phase;
  const showEmpty = phase === 'idle' && snap.state.messages.length === 0;

  if (showEmpty) {
    return <Empty c={c} {...common} onSubmit={a.sendMessage}/>;
  }

  const pending = snap.state.pendingPermission;
  const showNotifyBanner = !snap.settings.notifyEnabled && !snap.settings.notifyDismissed;

  return (
    <Chat
      c={c}
      state={snap.state}
      mode={common.mode}
      model={common.model}
      providerId={common.providerId}
      availableModels={common.availableModels}
      onSelectModel={common.onSelectModel}
      onSendMessage={a.sendMessage}
      onApproveExecution={a.approveExecution}
      onRejectExecution={a.rejectExecution}
      onAllow={() => pending && a.allow(pending.host, true)}
      onAllowOnce={() => pending && a.allow(pending.host, false)}
      onDeny={a.deny}
      onStop={a.stop}
      onRetry={a.retry}
      onChangeMode={a.setMode}
      onNewTask={common.onNewTask}
      onOpenSettings={common.onOpenSettings}
      onOpenHistory={common.onOpenHistory}
      showNotifyBanner={showNotifyBanner}
      onEnableNotify={() => {
        void saveSettingsDirect({ notifyEnabled: true });
        a.testNotify();
      }}
      onDismissNotify={() => { void saveSettingsDirect({ notifyDismissed: true }); }}
    />
  );
}
