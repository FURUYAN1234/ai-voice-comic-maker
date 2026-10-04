import { randomBytes, timingSafeEqual } from 'node:crypto';

export const LOCAL_HOST = '127.0.0.1';
export const API_PORT = 3001;
export const UI_PORT = 5174;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const COOKIE_NAME = 'voice_comic_session';

function matches(value, expected) {
  if (typeof value !== 'string') return false;
  const actual = Buffer.from(value);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

// Process-lifetime credentials only. No key, token or cookie is persisted or logged.
// This protects the local browser boundary, not against another local OS user/process.
export function installLocalSecurity(app, { apiPort = API_PORT, uiPort = UI_PORT } = {}) {
  const token = randomBytes(32).toString('hex');
  const cookie = randomBytes(32).toString('hex');
  const hosts = new Set([`localhost:${apiPort}`, `127.0.0.1:${apiPort}`]);
  const origins = new Set([apiPort, uiPort].flatMap(port =>
    [`http://localhost:${port}`, `http://127.0.0.1:${port}`]));

  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!hosts.has(req.headers.host)) return res.status(403).json({ error: 'LOCAL_HOST_REQUIRED' });
    // No CORS: the UI uses Vite's same-origin /api proxy.
    if ((req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'LOCAL_ORIGIN_REQUIRED' });
    }
    next();
  });
  app.get('/api/local-session', (req, res) => {
    // Custom header prevents HTML forms/images/navigation from bootstrapping a session.
    if (req.headers['x-voice-comic-client'] !== 'local-ui') {
      return res.status(403).json({ error: 'LOCAL_CLIENT_REQUIRED' });
    }
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${cookie}; HttpOnly; SameSite=Strict; Path=/api`);
    res.json({ csrfToken: token });
  });
  app.use('/api', (req, res, next) => {
    const cookies = (req.headers.cookie || '').split(';').map(part => part.trim());
    const supplied = cookies.find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!matches(supplied, cookie)) return res.status(401).json({ error: 'LOCAL_SESSION_REQUIRED' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        !matches(req.headers['x-voice-comic-csrf'], token)) {
      return res.status(403).json({ error: 'LOCAL_CSRF_REQUIRED' });
    }
    next();
  });
}
