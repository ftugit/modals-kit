/**
 * Водная копия переносимых HTTP/WS-адаптеров источника (`server/lib/db/adapters/proxy-*.ts`
 * SolidHono f8079b1), чтобы измерить поведение ядра над настоящим pgproxy БЕЗ
 * установки @juit/* зависимостями пакета. Полный перенос — задача CHECKLIST-2 §T3.2.
 *
 * Клиент берётся из лаборатории (`/home/user/pgproxy-lab`), переопределяется через
 * PGPROXY_MODULES. Node 20 не имеет глобального WebSocket → подставляется `ws`.
 */
import { pathToFileURL } from "node:url";

const MODS = process.env.PGPROXY_MODULES ?? "/home/user/pgproxy-lab/node_modules";
const load = async (name) => import(pathToFileURL(`${MODS}/${name}`).href);

export async function loadClients() {
  const [{ PGClient }, whatwg, ws] = await Promise.all([
    load("@juit/pgproxy-client/dist/index.mjs"),
    load("@juit/pgproxy-client-whatwg/dist/index.mjs"),
    load("ws/index.js"),
  ]);
  globalThis.WebSocket ??= ws.default ?? ws;
  return { PGClient, WHATWGProvider: whatwg.WHATWGProvider };
}

const assertConfig = ({ url, secret, allowInsecureLocalhost }) => {
  const u = new URL(url);
  if (u.username || u.password || u.search || u.hash)
    throw new Error("Proxy URL must not contain credentials, query or fragment");
  if (
    u.protocol !== "https:" &&
    !(allowInsecureLocalhost && u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
  )
    throw new Error("HTTPS proxy URL required");
  if (secret.length < 32) throw new Error("Proxy secret too short");
  return u;
};

export async function proxyRunner(config) {
  const { PGClient, WHATWGProvider } = await loadClients();
  const DbFailure = (await import("../../dist/db/errors")).DbFailure;
  const timeoutMs = config.timeoutMs ?? 15000;
  const max = config.maxInFlight ?? 4;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid proxy timeout");
  if (!Number.isSafeInteger(max) || max < 1) throw new Error("Invalid proxy concurrency limit");
  const { url: checked } = { url: assertConfig(config) };
  const make = (signal) => {
    const url = new URL(checked);
    url.username = config.secret;
    class Provider extends WHATWGProvider {
      _connectWebSocket(socket) {
        const cancel = () => {
          try {
            socket.close();
          } catch {}
        };
        signal?.addEventListener("abort", cancel, { once: true });
        socket.addEventListener("close", () => signal?.removeEventListener("abort", cancel), { once: true });
        if (signal?.aborted) {
          cancel();
          return Promise.reject(new DbFailure("unavailable"));
        }
        return super._connectWebSocket(socket);
      }
    }
    return new PGClient(
      new Provider(url, {
        WebSocket: globalThis.WebSocket,
        fetch: (input, init) => fetch(String(input), { ...init, signal: signal ?? init?.signal }),
      }),
    );
  };
  // валидация настроек до первого запроса (как в источнике)
  void make().destroy();
  const active = new Set();
  let closed = false;
  return {
    async run(fn) {
      if (closed || active.size >= max) throw new DbFailure("unavailable");
      const controller = new AbortController();
      const client = make(controller.signal);
      active.add(controller);
      let timer, cancel = () => {};
      try {
        return await Promise.race([
          Promise.resolve().then(() => fn(client)),
          new Promise((_, reject) => {
            cancel = () => {
              void client.destroy().catch(() => {});
              reject(new DbFailure("unavailable"));
            };
            controller.signal.addEventListener("abort", cancel, { once: true });
            timer = setTimeout(() => controller.abort(), timeoutMs);
          }),
        ]);
      } catch (e) {
        // прокси отдаёт {statusCode, error}: SQLSTATE в тексте → маппим вручную,
        // иначе `sqlstate: false` и любой конфликт станет 500
        const text = String(e?.message ?? e ?? "");
        const code = text.match(/\b(\d{5}|[0-9A-Z]{5})\b/)?.[1];
        if (code && Number.isInteger(Number("0x" + code)) === false && /^[0-9]{2}[0-9A-Z]{3}$/.test(code))
          e.sqlstateFromMessage = code;
        throw e;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.signal.removeEventListener("abort", cancel);
        controller.abort();
        active.delete(controller);
        await client.destroy().catch(() => {});
      }
    },
    async close() {
      closed = true;
      for (const c of active) c.abort();
    },
  };
}

export async function proxyAdapters(config) {
  const { result, runTransaction, transactionalCapabilities, unsupported } = await import("../../dist/db/adapters/shared");
  const DbFailure = (await import("../../dist/db/errors")).DbFailure;
  const http = {
    capabilities: { transactions: false, savepoints: false, sqlstate: false, isolationLevels: [] },
    async query(s) {
      const runner = await proxyRunner(config);
      this._runner ??= runner;
      const r = await this._runner.run((client) => client.query(s.text, s.values));
      return result(r.rows, r.rowCount);
    },
    async transaction() {
      return unsupported();
    },
    async close() {
      await this._runner?.close();
    },
  };
  const caps = { ...transactionalCapabilities, sqlstate: false };
  const ws = {
    capabilities: caps,
    async query(s) {
      this._runner ??= await proxyRunner(config);
      const r = await this._runner.run((client) => client.connect((c) => c.query(s.text, s.values)));
      return result(r.rows, r.rowCount);
    },
    async transaction(fn, options) {
      this._runner ??= await proxyRunner(config);
      return this._runner.run((client) =>
        client.connect((c) =>
          runTransaction(
            async (s) => {
              const r = await c.query(s.text, s.values);
              if (s.text === "COMMIT" && r.command !== "COMMIT") throw new DbFailure("transaction");
              return result(r.rows, r.rowCount);
            },
            caps,
            fn,
            options,
          ),
        ),
      );
    },
    async close() {
      await this._runner?.close();
    },
  };
  return { http, ws };
}
