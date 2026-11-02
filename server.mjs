// Кастомный сервер для @sveltejs/adapter-node: добавляет обработку HTTP `upgrade`
// для маршрута /api/form-upload (потоковые загрузки форм через WebSocket).
// Повторяет мост src/server/vite-ws.server.ts, но на чистом JS поверх build/.
//
// ВАЖНО: вся работа с IP клиента сосредоточена ЗДЕСЬ, на уровне сервера.
// Код приложения (src/) не меняется: clientIpOf() по-прежнему доверяет только
// event.getClientAddress(). Заголовки читаются ТОЛЬКО когда достоверно установлено,
// что процесс запущен на Northflank. В любом другом окружении IP берётся из
// реального TCP-сокета, и подменить его HTTP-заголовком невозможно.
import http from 'node:http';
import { isIP } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PassThrough } from 'node:stream';

// --- 1. Достоверное определение Northflank ----------------------------------
// Northflank сам инжектит в контейнер managed-переменные (docs: Inject secrets
// → "Access Northflank injected secrets"; changelog Q1 2023). Их не может
// задать HTTP-клиент. Требуем несколько независимых меток сразу и проверяем
// формат, чтобы случайное совпадение в другом окружении не включило доверие.
const NF_MARKERS = [
  'NF_OBJECT_ID', 'NF_PROJECT_ID', 'NF_HOSTS', 'NF_DEPLOYMENT_SHA',
  'NF_DEPLOYMENT_REPO', 'NF_DEPLOYMENT_BRANCH', 'NF_PLAN_ID',
  'NF_CPU_RESOURCES', 'NF_RAM_RESOURCES', 'NF_EPHEMERAL_STORAGE',
];

function northflankFingerprint() {
  const present = NF_MARKERS.filter(
    (key) => typeof process.env[key] === 'string' && process.env[key].trim() !== '',
  );
  if (present.length < 6) return { ok: false, count: present.length };
  if (!/^[0-9a-f]{40}$/i.test(process.env.NF_DEPLOYMENT_SHA.trim())) {
    return { ok: false, count: present.length };
  }
  const hosts = process.env.NF_HOSTS.toLowerCase();
  const custom = (process.env.NF_HOSTS_CUSTOM || '').trim().toLowerCase();
  const hostsOk = /\.code\.run/.test(hosts) || (custom !== '' && hosts.includes(custom));
  if (!hostsOk) return { ok: false, count: present.length };
  if (!/^nf-compute-/.test(process.env.NF_PLAN_ID.trim())) {
    return { ok: false, count: present.length };
  }
  const objectId = process.env.NF_OBJECT_ID.trim().toLowerCase();
  if (objectId && !hosts.includes(`--${objectId}--`) && !custom.includes(objectId)) {
    return { ok: false, count: present.length };
  }
  return { ok: true, count: present.length };
}

const killSwitch = process.env.KIT_TRUST_PROXY_HEADERS === '0'
  || process.env.KIT_TRUST_PROXY_HEADERS === 'off';
const fingerprint = northflankFingerprint();
const trustProxyHeaders = !killSwitch && fingerprint.ok;

// adapter-node читает ADDRESS_HEADER / XFF_DEPTH ОДИН РАЗ при импорте и тогда
// сам начинает доверять заголовкам, минуя нашу проверку окружения.
// Нейтрализуем их: единственный источник IP — этот файл.
for (const key of ['ADDRESS_HEADER', 'XFF_DEPTH']) {
  if (process.env[key] !== undefined) {
    console.warn(`[server] ${key} ignored: only server.mjs decides which headers to trust`);
    delete process.env[key];
  }
}
console.log(trustProxyHeaders
  ? `[server] proxy headers: ON (Northflank, ${fingerprint.count} managed vars)`
  : `[server] proxy headers: OFF (${killSwitch ? 'kill switch' : 'not a Northflank runtime'})`);

// --- 2. Извлечение доверенного адреса --------------------------------------
// Вызывается ТОЛЬКО при trustProxyHeaders. Northflank перезаписывает
// X-Envoy-External-Address, а в X-Forwarded-For дописывает реальный IP В КОНЕЦ,
// сохраняя поддельные префиксы клиента → берём последний.
function trustedClientIp(headers) {
  const envoy = headers['x-envoy-external-address'];
  const single = Array.isArray(envoy) ? envoy[0] : envoy;
  if (typeof single === 'string' && isIP(single.trim()) > 0) return single.trim();
  const raw = headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string' && value.trim()) {
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && isIP(last) > 0) return last;
  }
  return undefined;
}

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

const { handler } = await import('./build/handler.js');

const WS_PATH = '/api/form-upload';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  const incoming = trustProxyHeaders ? withTrustedAddress(req) : req;
  handler(incoming, res, () => {
    res.statusCode = 404;
    res.end();
  });
});

server.on('upgrade', (req, socket, head) => {
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
  const socketAddress = trustProxyHeaders
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
  dummyRes.on('finish', () => {
    if (!target.upgraded && !socket.destroyed) {
      const code = dummyRes.statusCode >= 400 ? dummyRes.statusCode : 400;
      if (socket.writable) {
        socket.write(
          `HTTP/1.1 ${code} ${dummyRes.statusMessage || 'Upgrade Rejected'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      }
      socket.destroy();
    }
    dummySocket.destroy();
  });

  upgradeStorage.run(target, () => {
    handler(synthReq, dummyRes, () => {
      dummyRes.statusCode = 404;
      dummyRes.end();
    });
  });
});

server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
