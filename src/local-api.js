let sessionPromise;

async function getLocalSession() {
  if (!sessionPromise) {
    sessionPromise = fetch('/api/local-session', {
      credentials: 'same-origin',
      headers: { 'X-Voice-Comic-Client': 'local-ui' },
    }).then(async response => {
      if (!response.ok) throw new Error(`Local session failed (${response.status})`);
      return response.json();
    }).catch(error => {
      sessionPromise = undefined;
      throw error;
    });
  }
  return sessionPromise;
}

export async function localApiFetch(url, options = {}) {
  const { csrfToken } = await getLocalSession();
  const headers = new Headers(options.headers);
  headers.set('X-Voice-Comic-CSRF', csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  // A restarted backend needs a new handshake; never replay a charged operation.
  if (response.status === 401) sessionPromise = undefined;
  return response;
}
