// Кастомный сервер для @sveltejs/adapter-node: добавляет обработку HTTP `upgrade`
// для маршрута /api/form-upload (потоковые загрузки форм через WebSocket).
// Повторяет мост src/server/vite-ws.server.ts, но на чистом JS поверх build/.
//
// IP из заголовков доступен только при явной конфигурации и доверенном TCP peer.
// Публичные host/origin проверяются до передачи запроса adapter-node.
import http from 'node:http';
import { isIP } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PassThrough } from 'node:stream';
import { bridgeIncomingRequest } from './tooling/node-request-bridge.mjs';
import { trustedClientIp } from './tooling/trusted-proxy-address.mjs';

// Заголовки доверяются только при явном включении И совпадении TCP peer с
// операторским списком. NF_* идентифицируют окружение, но не источник запроса.
const proxyEnabled = /^(1|true|yes|on)$/i.test((process.env.KIT_TRUST_PROXY_HEADERS || '').trim());
const normalIp = (ip) => (ip || '').replace(/^::ffff:/i, '');
const trustedPeers = new Set((process.env.KIT_TRUSTED_PROXY_IPS || '').split(',').map((ip) => normalIp(ip.trim())).filter(Boolean));
if ([...trustedPeers].some((ip) => !isIP(ip))) throw new Error('KIT_TRUSTED_PROXY_IPS must contain exact IP addresses');
if (proxyEnabled && !trustedPeers.size) throw new Error('KIT_TRUST_PROXY_HEADERS requires KIT_TRUSTED_PROXY_IPS');
if (!proxyEnabled && process.env.NF_HOSTS) {
  console.warn('[server] proxy IP headers OFF: configure trusted peer IPs before enabling; rate limits may see the proxy address');
}
const trustRequest = (req) => proxyEnabled && trustedPeers.has(normalIp(req.socket?.remoteAddress));

// Внешние настройки adapter-node не должны обходить нашу проверку доверия.
for (const key of ['ADDRESS_HEADER', 'XFF_DEPTH', 'PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER']) {
  if (process.env[key] !== undefined) console.warn(`[server] ${key} ignored`);
  delete process.env[key];
}
process.env.PROTOCOL_HEADER = 'x-kit-internal-proto';
process.env.HOST_HEADER = 'x-kit-internal-host';

const allowedOrigins = new Map();
function addOrigin(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash)
    throw new Error('Invalid configured public origin');
  const previous = allowedOrigins.get(u.host.toLowerCase());
  if (previous && previous !== u.protocol.slice(0, -1)) throw new Error('Conflicting public origin schemes');
  allowedOrigins.set(u.host.toLowerCase(), u.protocol.slice(0, -1));
}
for (const origin of (process.env.KIT_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) addOrigin(origin);
if (process.env.ORIGIN) addOrigin(process.env.ORIGIN.trim());
// ORIGIN adapter-node закрепляет один origin для всех Host, обходя runtime-проверку.
delete process.env.ORIGIN;
for (const host of (process.env.NF_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)) addOrigin(`https://${host}`);

function applyOrigin(req) {
  delete req.headers['x-kit-internal-proto'];
  delete req.headers['x-kit-internal-host'];
  const hostCount = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length;
  if (hostCount !== 1) return false;
  const host = req.headers.host;
  if (typeof host !== 'string' || !host || /[\s/@?#\\]/.test(host)) return false;
  let parsed;
  try { parsed = new URL(`http://${host}`); } catch { return false; }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
  let authority = parsed.host.toLowerCase();
  let protocol;
  for (const scheme of ['https', 'http']) {
    const candidate = new URL(`${scheme}://${host}`).host.toLowerCase();
    if (allowedOrigins.get(candidate) === scheme) { protocol = scheme; authority = candidate; break; }
  }
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : Number(process.env.PORT || 3000);
  const peer = normalIp(req.socket?.remoteAddress);
  const localPeer = peer === '127.0.0.1' || peer === '::1';
  if (!protocol && localPeer && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase()) && Number(parsed.port || 80) === port) protocol = 'http';
  if (!protocol) return false;
  req.headers['x-kit-internal-proto'] = protocol;
  req.headers['x-kit-internal-host'] = authority;
  return true;
}

// --- 2. Извлечение доверенного адреса --------------------------------------
// Только после проверки TCP peer. Оператор обязан подтвердить, что каждый
// разрешённый peer дописывает/перезаписывает XFF и не допускает обхода.
// X-Envoy-External-Address может быть унаследован без перезаписи и игнорируется.

/** Подменить remoteAddress у ОДНОГО запроса, не трогая сам сокет (keep-alive). */
function withTrustedAddress(req) {
  const ip = trustedClientIp(req.headers);
  if (!ip) return req;
  const real = req.socket;
  const view = new Proxy(real, {
    get(target, prop) {
      if (prop === 'remoteAddress') return ip;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  Object.defineProperty(req, 'socket', { value: view, configurable: true });
  Object.defineProperty(req, 'connection', { value: view, configurable: true });
  return req;
}

const ALS_SYMBOL = Symbol.for('modals-kit/node-ws-upgrade-als');
const upgradeStorage = new AsyncLocalStorage();
globalThis[ALS_SYMBOL] = upgradeStorage;

// adapter-node по умолчанию обрывает тело после 512 KiB, хотя действующий
// бюджет форм по умолчанию 2 MiB. Значение в байтах совпадает с FORM_BODY_LIMIT;
// сам бюджет приложения не повышаем. Явный BODY_SIZE_LIMIT сохраняем.
if (!process.env.BODY_SIZE_LIMIT) {
  const raw = process.env.FORM_BODY_LIMIT;
  if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
    throw new Error('FORM_BODY_LIMIT must be a positive integer in bytes');
  }
  process.env.BODY_SIZE_LIMIT = raw || String(2 * 1024 * 1024);
}

const { handler } = await import('./build/handler.js');

const WS_PATH = '/api/form-upload';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const activeUpgrades = new Set();
let shuttingDown = false;
const server = http.createServer((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  const fail = (error) => {
    console.error('[server] HTTP handler failed:', error?.constructor?.name ?? 'Error');
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } else if (!res.destroyed) res.destroy();
  };
  try {
    if (!applyOrigin(req)) { res.statusCode = 421; res.end('Misdirected Request'); return; }
    const incoming = trustRequest(req) ? withTrustedAddress(req) : req;
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) > 0;
    const adapted = hasBody ? bridgeIncomingRequest(incoming, res) : incoming;
    Promise.resolve(handler(adapted, res, () => {
      res.statusCode = 404;
      res.end();
    })).catch(fail);
  } catch (error) { fail(error); }
});

server.on('upgrade', (req, socket, head) => {
  if (shuttingDown) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
  // Весь upgrade принадлежит этому серверу. Защищаем сокет до dispatch.
  socket.on('error', () => { if (!socket.destroyed) socket.destroy(); });
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', 'http://ws.local').pathname;
  } catch {
    socket.destroy();
    return;
  }
  const protocol = String(req.headers['sec-websocket-protocol'] ?? '');
  if (protocol.includes('vite-hmr') || pathname !== WS_PATH) {
    socket.destroy();
    return;
  }

  // На Northflank подменяем адрес из доверенных заголовков; в остальных
  // окружениях оставляем настоящий remoteAddress (как в vite-ws.server.ts).
  if (!applyOrigin(req)) {
    socket.end('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const socketAddress = trustRequest(req)
    ? (trustedClientIp(req.headers) ?? socket.remoteAddress ?? '127.0.0.1')
    : (socket.remoteAddress ?? '127.0.0.1');

  const dummySocket = new PassThrough();
  dummySocket.resume();
  dummySocket.on('error', () => {});
  Object.defineProperty(dummySocket, 'remoteAddress', {
    value: socketAddress,
    configurable: true,
  });

  const synthReq = new http.IncomingMessage(dummySocket);
  synthReq.method = 'GET';
  synthReq.url = req.url ?? WS_PATH;
  synthReq.headers = { ...req.headers };
  synthReq.push(null);

  const dummyRes = new http.ServerResponse(synthReq);
  dummyRes.assignSocket(dummySocket);

  const target = { req, socket, head, upgraded: false };
  activeUpgrades.add(target);
  socket.once('close', () => activeUpgrades.delete(target));
  dummyRes.on('finish', () => {
    if (!target.upgraded && !socket.destroyed) {
      const code = dummyRes.statusCode >= 400 ? dummyRes.statusCode : 400;
      if (socket.writable) {
        socket.write(
          `HTTP/1.1 ${code} ${String(dummyRes.statusMessage || 'Upgrade Rejected').replace(/[\r\n]+/g, ' ')}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      }
      socket.destroy();
    }
    dummySocket.destroy();
  });

  const failUpgrade = (error) => {
    console.error('[server] upgrade handler failed:', error?.constructor?.name ?? 'Error');
    if (!target.upgraded && !socket.destroyed && socket.writable) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
    if (!socket.destroyed) socket.destroy();
    dummySocket.destroy();
  };
  try {
    upgradeStorage.run(target, () => {
      Promise.resolve(handler(synthReq, dummyRes, () => {
        dummyRes.statusCode = 404;
        dummyRes.end();
      })).catch(failUpgrade);
    });
  } catch (error) { failUpgrade(error); }
});

server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const target of activeUpgrades) {
    try {
      if (target.shutdown) target.shutdown();
      else target.socket.destroy();
    } catch { target.socket.destroy(); }
  }
  // Allow HTTP responses and cooperative upload cleanup to settle. A platform
  // kill or the final hard deadline can still interrupt arbitrary user code.
  const timer = setTimeout(() => {
    server.closeAllConnections();
    for (const target of activeUpgrades) target.socket.destroy();
    process.exit(0);
  }, 5_000);
  timer.unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
