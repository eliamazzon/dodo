import { useState } from 'react';
import { DODO_LIGHT } from '../shared/tokens';
import { useAgent } from './hooks/useAgent';
import { Empty } from './screens/Empty';
import { Chat } from './screens/Chat';
import { Settings } from './screens/Settings';
import { History } from './screens/History';
import { RequireApiKey } from './screens/RequireApiKey';
import { getProvider } from '../background/providers';

type View = 'agent' | 'settings' | 'history';

export function App() {
  const c = DODO_LIGHT;
  const [view, setView] = useState<View>('agent');
  const a = useAgent();
  const { snap } = a;

  if (view === 'settings') {
    return <Settings c={c} settings={snap.settings} onUpdate={a.setSettings} onClose={() => setView('agent')} onTestNotify={a.testNotify}/>;
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

  if (!a.hydrated) return <div style={{ width: '100%', height: '100%', background: c.bg }} />;

  if (!snap.settings.apiKey) {
    return <RequireApiKey c={c} onOpenSettings={() => setView('settings')} onOpenHistory={() => setView('history')}/>;
  }

  const provider = getProvider(snap.settings.providerId);
  const common = {
    model: snap.settings.model,
    mode: snap.settings.defaultMode,
    providerId: snap.settings.providerId,
    availableModels: provider.availableModels,
    onSelectModel: (id: string) => { a.setSettings({ model: id }); },
    onChangeMode: a.setMode,
    onNewTask: a.reset,
    onOpenSettings: () => setView('settings'),
    onOpenHistory: () => setView('history'),
  };

  // Only surface an update when origin is genuinely ahead and the user hasn't waved off this exact
  // head — mirrors hasPendingUpdate() in background/updates.ts.
  const pendingUpdate =
    a.update && a.update.aheadBy > 0 && a.update.dismissedSha !== a.update.latestSha ? a.update : null;
  const updateProps = {
    update: pendingUpdate,
    onApplyUpdate: a.applyUpdate,
    onDismissUpdate: a.dismissUpdate,
  };

  const phase = snap.state.phase;
  const showEmpty = phase === 'idle' && snap.state.messages.length === 0;

  if (showEmpty) {
    return <Empty c={c} {...common} {...updateProps} onSubmit={a.sendMessage}/>;
  }

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
      onDecide={a.decidePermission}
      onDeny={a.deny}
      onConfirmCritical={a.confirmCritical}
      onDenyCritical={a.denyCritical}
      onStop={a.stop}
      onRetry={a.retry}
      onChangeMode={a.setMode}
      onNewTask={common.onNewTask}
      onOpenSettings={common.onOpenSettings}
      onOpenHistory={common.onOpenHistory}
      showNotifyBanner={showNotifyBanner}
      onEnableNotify={() => {
        a.setSettings({ notifyEnabled: true });
        a.testNotify();
      }}
      onDismissNotify={() => { a.setSettings({ notifyDismissed: true }); }}
      {...updateProps}
    />
  );
}
