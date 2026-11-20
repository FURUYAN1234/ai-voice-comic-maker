/* global __FURU_MCP_IDENTITY__: readonly */
import './mcp-connection.css';

function showMcpResources(appId, mount) {
  const nav = document.createElement('nav');
  nav.className = 'furu-mcp-resources';
  nav.setAttribute('aria-label', 'MCPのスキルと導入ガイド');
  const skill = document.createElement('a');
  skill.href = './downloads/' + appId + '-mcp-skill.zip';
  skill.download = '';
  skill.textContent = '制作スキルを取得';
  const guide = document.createElement('a');
  guide.href = './downloads/' + appId + '-mcp-guide.html';
  guide.target = '_blank';
  guide.rel = 'noopener noreferrer';
  guide.textContent = 'MCP導入ガイド';
  nav.append(skill, guide);
  mount.append(nav);
  return nav;
}

export function connectFuruMcp({ appId, execute, stop, mount = document.body, controlMount, statusMount, readiness = () => false, onConnection = () => {} }) {
  const toolbar = showMcpResources(appId, mount);
  const removeResources = () => toolbar.remove();
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || typeof __FURU_MCP_IDENTITY__ === 'undefined') return removeResources;
  const identity = __FURU_MCP_IDENTITY__;
  if (Number(location.port) !== identity.connectionPort) return removeResources;
  const endpoint = new URL('./__furu_mcp__/', location.href);
  const bar = document.createElement('aside');
  bar.className = 'furu-mcp-connection';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = 'MCP 未接続';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'MCP接続';
  (statusMount || bar).append(status);
  bar.append(button);
  (controlMount || toolbar).append(bar);

  let session;
  let connecting = false;
  let disposed = false;

  async function request(route, data, auth) {
    const response = await fetch(new URL(route, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
      keepalive: route === 'disconnect',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const message = payload?.code === 'BUILD_MISMATCH'
        ? 'MCPの接続には更新版の再起動が必要です。'
        : payload?.message || 'ローカルMCPと通信できません。';
      throw Object.assign(new Error(message), { status: response.status });
    }
    return payload;
  }

  function cancelWork(link) {
    if (link.job && !link.job.cancelled) {
      link.job.cancelled = true;
      link.job.stopResult = Promise.resolve().then(stop).then(() => true, () => false);
    }
  }

  function endSession(message, notify = true, stopManualWork = false) {
    const link = session;
    session = undefined;
    document.body.classList.remove('furu-mcp-active');
    if (link) onConnection(false);
    if (link) {
      clearTimeout(link.timer);
      if (stopManualWork && !link.job) void Promise.resolve().then(stop).catch(() => {});
      else cancelWork(link);
      if (notify) void request('disconnect', {}, link.token).catch(() => {});
    }
    status.textContent = message;
    button.textContent = 'MCP接続';
    button.onclick = () => void connect('connect_local');
  }

  function dispose() {
    disposed = true;
    endSession('');
    window.removeEventListener('hashchange', pairFromUrl);
    window.removeEventListener('pagehide', dispose);
    bar.remove();
    status.remove();
    removeResources();
  }

  async function perform(link, job) {
    const active = { id: job.id, cancelled: false, reporting: false };
    link.job = active;
    status.textContent = 'MCP 処理中';
    let payload;
    try {
      const result = await execute(job.operation, job.input);
      payload = active.cancelled ? { state: 'cancelled' } : { state: 'succeeded', result };
    } catch (error) {
      payload = active.cancelled || error?.name === 'AbortError'
        ? { state: 'cancelled' }
        : { state: 'failed', code: ['API_REQUIRED', 'APP_BUSY', 'INPUT_REQUIRED', 'OUTPUT_INVALID', 'NO_LIVE_SOURCES'].includes(error?.code) ? error.code : 'APP_OPERATION_FAILED' };
    }
    if (active.stopResult && !await active.stopResult) payload = { state: 'failed', code: 'CANCEL_CONFIRMATION_FAILED' };
    if (session !== link) return;
    active.reporting = true;
    try {
      await request('result', { id: job.id, ...payload }, link.token);
      if (session === link) status.textContent = 'MCP 接続済み';
    } catch {
      // A lost acknowledgment does not authorize a second provider request.
      if (session === link) endSession('MCPで結果を確認できませんでした。ジョブの状態を確認してください。');
    } finally {
      link.job = undefined;
    }
  }

  async function poll(link) {
    try {
      const next = await request('poll', {
        busy: Boolean(link.job), accepting: true, providerReady: Boolean(readiness()),
      }, link.token);
      if (session !== link) return;
      link.failureSince = 0;
      if (next.cancel && link.job?.id === next.cancel && !link.job.reporting) cancelWork(link);
      if (next.job && !link.job) void perform(link, next.job);
    } catch (error) {
      if (session !== link) return;
      link.failureSince ||= Date.now();
      if ([401, 403, 409].includes(error.status) || Date.now() - link.failureSince > 15000) {
        endSession('MCP接続が切れました。再接続できます。', false);
      }
    } finally {
      if (session === link) link.timer = setTimeout(() => void poll(link), 500);
    }
  }

  async function connect(route, ticket) {
    if (connecting || disposed || session) return;
    connecting = true;
    status.textContent = 'MCP 接続中…';
    button.disabled = true;
    try {
      const result = await request(route, identity, ticket);
      if (disposed) {
        void request('disconnect', {}, result.token).catch(() => {});
        return;
      }
      session = { token: result.token, failureSince: 0 };
      document.body.classList.add('furu-mcp-active');
      onConnection(true);
      status.textContent = 'MCP 接続済み';
      button.textContent = '停止して手動に戻る';
      button.onclick = () => endSession('MCPを切断しました。手動操作に戻れます。', true, true);
      void poll(session);
    } catch (error) {
      status.textContent = error.message || 'MCPに接続できませんでした。';
    } finally {
      button.disabled = false;
      connecting = false;
    }
  }

  function pairFromUrl() {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('mcp');
    if (!ticket) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    void connect('connect', ticket);
  }

  button.onclick = () => void connect('connect_local');
  window.addEventListener('hashchange', pairFromUrl);
  window.addEventListener('pagehide', dispose, { once: true });
  pairFromUrl();
  return dispose;
}

export function mcpAppError(code) {
  return Object.assign(new Error(code), { code });
}
