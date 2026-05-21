async function prepareReactRefresh() {
  if (import.meta.env.MODE !== 'development' || typeof window === 'undefined') return;

  const refreshRuntimeUrl = '/@react-refresh';
  const RefreshRuntime = await import(/* @vite-ignore */ refreshRuntimeUrl);
  RefreshRuntime.default.injectIntoGlobalHook(window);
  (window as any).$RefreshReg$ = () => {};
  (window as any).$RefreshSig$ = () => (type: unknown) => type;
  (window as any).__vite_plugin_react_preamble_installed__ = true;
}

prepareReactRefresh().then(() => import('./bootstrap'));
