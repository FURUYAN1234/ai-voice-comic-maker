import net from 'node:net';
import http from 'node:http';
import { isMainThread } from 'node:worker_threads';

// Remotion 4's internal asset/proxy servers bind wildcard addresses. Keep its
// public renderer API, but constrain TCP listeners inside our dedicated worker.
// This must never be installed in the Express/main thread or external packages.
export function restrictRenderListeners(onListening = () => {}) {
  if (isMainThread) throw new Error('Render listener restriction requires a dedicated worker');
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === 'request') {
      const [req, res] = args;
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!hosts.includes(req.headers.host) ||
          (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) ||
          req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('LOCAL_RENDER_ORIGIN_REQUIRED');
        return true;
      }
    }
    return originalEmit.call(this, event, ...args);
  };
  const original = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const first = args[0];
    let options;
    if (first && typeof first === 'object' && Object.hasOwn(first, 'port') &&
        Object.keys(first).every(key => ['port', 'host', 'backlog', 'exclusive', 'ipv6Only', 'reusePort', 'signal'].includes(key))) {
      options = { ...first };
    } else if (typeof first === 'number') {
      options = { port: first };
      if (typeof args[1] === 'string') options.host = args[1];
      const backlog = args.slice(1).find(arg => typeof arg === 'number');
      if (backlog !== undefined) options.backlog = backlog;
    } else {
      throw new Error('Unsupported render listener signature');
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535 ||
        (options.host && !['0.0.0.0', '::', 'localhost', '127.0.0.1', '::1'].includes(options.host))) {
      throw new Error('Non-local render listener rejected');
    }
    options.host = '127.0.0.1';
    options.ipv6Only = false;
    this.once('listening', () => {
      const address = this.address();
      if (!address || typeof address !== 'object' || address.address !== '127.0.0.1') {
        this.close();
        throw new Error('Render listener escaped loopback');
      }
      onListening(address);
    });
    const callback = args.find(arg => typeof arg === 'function');
    return callback ? original.call(this, options, callback) : original.call(this, options);
  };
}
