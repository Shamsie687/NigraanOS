// Run before module loading/auth SDK startup. No storage, logging or network.
if (window.location.pathname === '/agent-callback') {
  window.__nigraanMcpCallback = window.location.href;
  window.history.replaceState(null, '', '/agent-callback#/agent-callback');
}
