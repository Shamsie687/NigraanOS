export function mcpDeploymentConfig(endpoint, callback) {
  const url = new URL(endpoint);
  const local = endpoint === 'http://127.0.0.1:8787';
  if ((!local && url.protocol !== 'https:') || url.origin !== endpoint || url.username || url.password)
    throw new Error('MCP authorization is not configured.');
  const redirect = callback || (local ? 'http://127.0.0.1:8788/callback' : '');
  const target = new URL(redirect);
  if ((!local && target.protocol !== 'https:') || (local && !['http://127.0.0.1:8788/callback','http://127.0.0.1:5173/agent-callback','http://localhost:5173/agent-callback'].includes(redirect)) ||
      target.username || target.password || target.hash || target.search)
    throw new Error('MCP callback is not configured.');
  return {endpoint, redirect: target.href};
}
