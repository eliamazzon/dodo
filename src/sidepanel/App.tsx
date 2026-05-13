import { useState } from 'react';
import { DODO_LIGHT } from '../shared/tokens';
import { useAgent, saveSettingsDirect } from './hooks/useAgent';
import { Empty } from './screens/Empty';
import { PlanCreating } from './screens/PlanCreating';
import { PlanApproval } from './screens/PlanApproval';
import { Working } from './screens/Working';
import { Permissions } from './screens/Permissions';
import { ErrorState } from './screens/ErrorState';
import { Complete } from './screens/Complete';
import { Settings } from './screens/Settings';
import { History } from './screens/History';

type View = 'agent' | 'settings' | 'history';

export function App() {
  const c = DODO_LIGHT;
  const [view, setView] = useState<View>('agent');
  const a = useAgent();
  const { snap } = a;

  if (view === 'settings') {
    return <Settings c={c} settings={snap.settings} onClose={() => setView('agent')}/>;
  }
  if (view === 'history') {
    return <History c={c} items={snap.history} onClose={() => setView('agent')}/>;
  }

  const common = {
    model: snap.settings.model,
    mode: snap.settings.defaultMode,
    onChangeMode: a.setMode,
    onNewTask: a.reset,
    onOpenSettings: () => setView('settings'),
    onOpenHistory: () => setView('history'),
  };

  const phase = snap.state.phase;
  const task = snap.state.task ?? '';

  if (phase === 'idle') {
    return <Empty c={c} {...common} onSubmit={a.submit}/>;
  }
  if (phase === 'planning') {
    return <PlanCreating c={c} task={task} {...common} onStop={a.stop}/>;
  }
  if (phase === 'awaiting_approval' && snap.state.plan) {
    return (
      <PlanApproval
        c={c} task={task} model={common.model} plan={snap.state.plan}
        onApprove={a.approve} onEdit={a.editPlan}
        onNewTask={common.onNewTask}
        onOpenSettings={common.onOpenSettings} onOpenHistory={common.onOpenHistory}
      />
    );
  }
  if (phase === 'awaiting_permission' && snap.state.pendingPermission) {
    return (
      <Permissions
        c={c} task={task} model={common.model}
        pending={snap.state.pendingPermission}
        onAllow={() => a.allow(snap.state.pendingPermission!.host, true)}
        onAllowOnce={() => a.allow(snap.state.pendingPermission!.host, false)}
        onDeny={a.deny}
        onNewTask={common.onNewTask}
        onOpenSettings={common.onOpenSettings} onOpenHistory={common.onOpenHistory}
      />
    );
  }
  if (phase === 'working') {
    const showBanner = !snap.settings.notifyEnabled && !snap.settings.notifyDismissed;
    return (
      <Working
        c={c} task={task} {...common}
        calls={snap.state.toolCalls}
        workingLabel={snap.state.workingLabel}
        startedAt={snap.state.startedAt}
        notifyEnabled={!showBanner}
        onEnableNotify={() => {
          void saveSettingsDirect({ notifyEnabled: true });
          a.testNotify();
        }}
        onDismissNotify={() => { void saveSettingsDirect({ notifyDismissed: true }); }}
        onStop={a.stop} onSubmit={a.submit}
      />
    );
  }
  if (phase === 'error') {
    return (
      <ErrorState
        c={c} task={task} {...common}
        calls={snap.state.toolCalls}
        errorMsg={snap.state.errorMsg ?? 'unknown error'}
        onRetry={a.retry} onReset={a.reset} onSubmit={a.submit}
      />
    );
  }
  if (phase === 'complete' && snap.state.complete) {
    return (
      <Complete
        c={c} task={task} {...common}
        complete={snap.state.complete}
        steps={snap.state.toolCalls.length}
        onSubmit={a.continueChat}
      />
    );
  }
  return <Empty c={c} {...common} onSubmit={a.submit}/>;
}
