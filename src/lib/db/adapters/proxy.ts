import { DbFailure } from "../errors";
import { result, runTransaction, transactionalCapabilities, unsupported } from "./shared";
import type { Capabilities, Driver, QueryResult, Row, Statement, TxOptions } from "../types";

/**
 * Postgres за HTTP/WS-прокси (`@juit/pgproxy`-совместимый протокол): запрос уезжает
 * JSON-ом `{id, query, params}`, ответ приходит `{id, statusCode, rows, rowCount, command}`.
 *
 * Почему это вообще отдельный адаптер: у части хостингов (free-контейнеры, панели с
 * одним HTTP-портом, домены за Cloudflare) TCP 5432 наружу не отдаётся вовсе, и прокси
 * — единственная дверь. Разница двух режимов принципиальная:
 *
 *  • `http` — **без сессии**: сервер берёт соединение из пула на каждый запрос и
 *    возвращает его сразу, поэтому `BEGIN … COMMIT` через него не имеет смысла →
 *    транзакций нет, `capabilities.transactions = false`;
 *  • `ws` — одно WebSocket-соединение = один backend до закрытия сокета, поэтому
 *    транзакции, savepoint'ы и `SET LOCAL` работают как на нативном `pg`.
 *
 * Оба режима теряют SQLSTATE: в error-фрейме прокси лежит только текст
 * (`statusCode: 400, error: "<msg>"`), кода нет → `sqlstate: false`, и ядро честно
 * отдаст 500 вместо 409 на конфликте уникальности. Врать и угадывать `conflict` по
 * тексту хуже, чем 500: `expose.constraints` построен на SQLSTATE.
 *
 * Zero-dep намеренно: транспорт = `fetch` + `WebSocket` + Web Crypto (Node 18+,
 * Workers, Deno). В отличие от `@juit/pgproxy-client-whatwg` тут нет node-специфики,
 * и транспорт инъектится в тестах.
 */
export type ProxyMode = "http" | "ws";

export interface ProxyConfig {
  /** `https://host[:port][/path]`; для `mode: 'ws'` та же строка, схема меняется сама. */
  url: string;
  /** Секрет прокси (тот же, что в `PGPROXYSECRET`); подписывает одноразовый `?auth=`-токен. */
  secret: string;
  /** Разрешить `http://localhost|127.0.0.1|[::1]` — только для локальных прогонов. */
  allowInsecureLocalhost?: boolean;
  /** Технический дедлайн одной операции (включая хендшейк и тело ответа). Default 15000. */
  timeoutMs?: number;
  /** Fail-fast без очереди: лишняя параллельная операция обязана отказать сразу. Default 4. */
  maxInFlight?: number;
  /** Тестам подменяет транспорт; в приложении не используется. */
  fetch?: typeof globalThis.fetch;
  /** Тестам подменяет конструктор WebSocket (на Node < 21 его нет). */
  WebSocket?: unknown;
}

interface ProxyFrame {
  id?: string;
  statusCode?: number;
  error?: string;
  /** прокси отдаёт **кортежи**, а не объекты: `rows: [["1","x"]]`, имена — в `fields`. */
  rows?: unknown[][] | Row[];
  rowCount?: number | null;
  command?: string;
  fields?: Array<[string, number]>;
}

/**
 * Маппинг OID → тип. Прокси переносит значения текстом text-протокола, а ядро (и
 * `pg`-адаптер) отдаёт строки объектами с нативными типами, поэтому разбор по OID —
 * часть адаптера, а не «приятный бонус»: без него `count` приходит строкой, `active` —
 * строкой «t», и `field(t.boolean)` отваливается на валидации прочитанных данных.
 * Совпадение с `pg` важно и в обратную сторону: int8/numeric там остаются строками.
 */
const ARRAY_ELEMENT_OID: Record<number, number> = {
  1000: 16, 1005: 21, 1007: 23, 1009: 25, 1015: 1043, 1016: 20, 1021: 700,
  1022: 701, 199: 114, 3807: 3802, 1115: 1114, 1182: 1184, 1231: 1700,
};

function parseByOid(value: string, oid: number): unknown {
  switch (oid) {
    case 16:
      return value === "t" || value === "true" || value === "1";
    case 21:
    case 23:
    case 26:
    case 700:
    case 701: {
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case 114:
    case 3802:
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    case 1114:
    case 1184: {
      const d = new Date(value.endsWith("Z") || /[+-]\d\d$/.test(value) ? value : value + "Z");
      return Number.isNaN(d.getTime()) ? value : d;
    }
    default: {
      const element = ARRAY_ELEMENT_OID[oid];
      if (element !== undefined && value.startsWith("{")) return parsePgArray(value, element);
      // int8, numeric, date, bytea, unknown → текст, как это делает pg по умолчанию.
      return value;
    }
  }
}

/** `{a,"b c",NULL,{d}}` — pg-литерал массива, вложенность поддерживается (у нас она не встречается). */
function parsePgArray(input: string, elementOid: number): unknown[] {
  let i = 0;
  const readLevel = (): unknown[] => {
    const out: unknown[] = [];
    i++; // '{'
    while (i < input.length) {
      const ch = input[i];
      if (ch === "}") {
        i++;
        break;
      }
      if (ch === ",") {
        i++;
        continue;
      }
      if (input.startsWith("NULL", i)) {
        i += 4;
        out.push(null);
        continue;
      }
      if (ch === "{") {
        out.push(readLevel());
        continue;
      }
      let raw = "";
      if (ch === '"') {
        i++;
        while (i < input.length) {
          if (input[i] === "\\") {
            raw += input[i + 1] ?? "";
            i += 2;
            continue;
          }
          if (input[i] === '"') {
            i++;
            break;
          }
          raw += input[i];
          i++;
        }
      } else {
        while (i < input.length && input[i] !== "," && input[i] !== "}") raw += input[i++];
      }
      out.push(parseByOid(raw, elementOid));
    }
    return out;
  };
  return readLevel();
}

function toRow(fields: Array<[string, number]> | undefined, tuple: unknown): Row {
  if (!Array.isArray(tuple)) return tuple as Row; // прокси мог отдать и объекты — не ломаем
  if (!fields?.length) return Object.fromEntries(tuple.map((v, i) => [String(i), v])) as Row;
  const row: Record<string, unknown> = {};
  fields.forEach(([name, oid], i) => {
    const value = tuple[i];
    row[name] =
      value === null || value === undefined
        ? null
        : typeof value === "string"
          ? parseByOid(value, oid)
          : value;
  });
  return row as Row;
}

/**
 * 48 байт: int64LE(`Date.now()`) + 8 байт nonce, затем 32 байта HMAC-SHA256(secret,
 * первые 16) → base64url ровно 64 символа. Сервер сверяет подпись и требует, чтобы
 * время клиента отличалось от его собственного не больше чем на 10 с.
 */
async function createToken(secret: string): Promise<string> {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle || !webcrypto.getRandomValues)
    throw new Error("Web Crypto is required to sign pgproxy auth tokens");
  const buffer = new ArrayBuffer(48);
  const bytes = new Uint8Array(buffer);
  webcrypto.getRandomValues(bytes);
  new DataView(buffer, 0, 8).setBigInt64(0, BigInt(Date.now()), true);
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign("HMAC", key, new Uint8Array(buffer, 0, 16));
  bytes.set(new Uint8Array(signature), 16);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
}

/**
 * `params` прокси передаёт в `pg` как есть, и протокол ждёт **строки или null**
 * (`(string | null)[]`). Собираем их тут же, по правилам text-протокола: иначе массив
 * уехал бы JSON-ом (`["a","b"]` вместо `{a,b}`), а `undefined` — как `null` без
 * возможности отличить «поля нет» от «значения нет».
 */
function encodeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Object.is(value, -0) ? "0" : String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array)
    return "\\x" + [...value].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (Array.isArray(value))
    return "{" + value.map((v) => encodeArrayItem(v)).join(",") + "}";
  return JSON.stringify(value);
}

function encodeArrayItem(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (Array.isArray(value))
    return "{" + value.map((v) => encodeArrayItem(v)).join(",") + "}";
  const text = typeof value === "string" ? value : String(encodeValue(value) ?? "");
  return /[",{}\\]|^\s|\s$|^$|^NULL$/i.test(text)
    ? '"' + text.replaceAll("\\", "\\\\").replaceAll('"', '\\\"') + '"'
    : text;
}

function encodeValues(values: readonly unknown[] | undefined): (string | null)[] | undefined {
  if (!values?.length) return undefined;
  return values.map(encodeValue);
}

function decodeFrame(frame: ProxyFrame): QueryResult {
  if (frame.statusCode !== 200) {
    const code = frame.statusCode ?? 0;
    // 401/403 — «мы не попали в прокси», а не «SQL ошибся»: их нельзя класть в одну
    // категорию с 500, иначе деградация transport'а выглядит как битые данные.
    if (code === 401 || code === 403)
      throw new DbFailure("unavailable", {
        issues: [
          `pgproxy отклонил авторизацию (${code}): одноразовый ?auth=-токен подписывается локальным временем, и расхождение часов клиента и прокси больше 10 с даёт именно это.`,
        ],
      });
    throw new DbFailure("database", { issues: [String(frame.error ?? `pgproxy statusCode=${code}`)] });
  }
  const rows = (frame.rows ?? []).map((tuple) => toRow(frame.fields, tuple));
  return result(rows, frame.rowCount ?? rows.length);
}

/** Валидация конфига — до первого сокета: кривой URL должен падать на старте приложения, а не на запросе. */
function normalize(config: ProxyConfig, mode: ProxyMode) {
  const timeoutMs = config.timeoutMs ?? 15000,
    max = config.maxInFlight ?? 4;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2147483647 ||
    !Number.isSafeInteger(max) ||
    max < 1
  )
    throw new Error("Invalid proxy limits");
  if (typeof config.secret !== "string" || config.secret.length < 32)
    throw new Error("Proxy secret too short");
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Proxy URL must not contain credentials, query or fragment");
  // Локальный прокси допускается только явным флагом; при этом `ws://` и `http://`
  // равноправны — схему для сокета выводим из входной, а не подменяем на «безопасную»:
  // иначе http://localhost:5434 превращается в https:// и получает WRONG_VERSION_NUMBER.
  const insecureScheme = url.protocol === "http:" || url.protocol === "ws:";
  const local =
    config.allowInsecureLocalhost === true &&
    insecureScheme &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (insecureScheme && !local) throw new Error("HTTPS proxy URL required");
  // WS-клиенту нужна socket-схема; https/wss оставляем как есть (idempotent), http/ws → ws.
  if (mode === "ws" && url.protocol !== "wss:")
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { url, timeoutMs, max, fetchImpl: config.fetch ?? globalThis.fetch };
}

/** Счётчик активных операций + дедлайн: отказаем сразу, а не копим очередь под таймаут функции. */
function admission(max: number, timeoutMs: number) {
  let active = 0,
    closed = false;
  const controllers = new Set<AbortController>();
  return {
    async run<T>(body: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (closed || active >= max) throw new DbFailure("unavailable");
      const controller = new AbortController();
      active++;
      controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          body(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new DbFailure("unavailable"));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controllers.delete(controller);
        active--;
        // Отмена обязательна и после успеха: иначе «зависший» запрос переживёт инвокацию.
        controller.abort();
      }
    },
    async close() {
      closed = true;
      for (const controller of [...controllers]) controller.abort();
    },
  };
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

async function readFrame(response: Response): Promise<ProxyFrame> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json"))
    throw new DbFailure("unavailable", {
      issues: [`pgproxy ответил не JSON (HTTP ${response.status}, content-type "${type || "—"}")`],
    });
  const frame = (await response.json().catch(() => null)) as ProxyFrame | null;
  if (!frame || typeof frame !== "object")
    throw new DbFailure("unavailable", { issues: [`pgproxy ответил пустоту (HTTP ${response.status})`] });
  return frame;
}

export function proxyHttpAdapter(config: ProxyConfig): Driver {
  const { url, timeoutMs, max, fetchImpl } = normalize(config, "http");
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const gate = admission(max, timeoutMs);
  return {
    capabilities: { transactions: false, savepoints: false, sqlstate: false, isolationLevels: [] },
    async query<T extends Row>(statement: Statement): Promise<QueryResult<T>> {
      return gate.run(async (signal) => {
        if (statement.signal?.aborted) throw new DbFailure("unavailable");
        const target = new URL(url.toString());
        // Токен одноразовый (прокси держит использованные 60 с) → новый на каждый запрос.
        target.searchParams.set("auth", await createToken(config.secret));
        const id = requestId();
        const response = await fetchImpl(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, query: statement.text, params: encodeValues(statement.values) }),
          signal,
        });
        const frame = await readFrame(response);
        // Прокси обязан вернуть тот же id; без сверки ответ от чужого запроса
        // выглядел бы как валидные строки.
        if (frame.id !== undefined && frame.id !== id)
          throw new DbFailure("unavailable", { issues: ["pgproxy: id в ответе не совпал с запросом"] });
        return decodeFrame(frame) as QueryResult<T>;
      });
    },
    async transaction<T>(): Promise<T> {
      return unsupported();
    },
    close: gate.close,
  };
}

/** Один WebSocket = один backend. Вне транзакции сокет не переиспользуется — ровно как в HTTP-режиме. */
class ProxySocket {
  #pending = new Map<string, { resolve(frame: ProxyFrame): void; reject(error: unknown): void }>();
  #closed = false;

  private constructor(
    private readonly socket: any,
    signal?: AbortSignal,
  ) {
    socket.addEventListener?.("message", (event: { data?: string }) =>
      this.#onMessage(String(event?.data ?? "")),
    );
    const fail = (message: string) => {
      if (this.#closed) return;
      this.#closed = true;
      for (const pending of this.#pending.values())
        pending.reject(new DbFailure("unavailable", { issues: [message] }));
      this.#pending.clear();
    };
    socket.addEventListener?.("close", () => fail("pgproxy: сокет закрыт"));
    socket.addEventListener?.("error", () => fail("pgproxy: ошибка сокета"));
    // Отмена могла прийти во время хендшейка: тогда сокет закрываем сразу, а не ждём
    // события, которого не будет.
    if (signal?.aborted) this.#destroy();
    else signal?.addEventListener("abort", () => this.#destroy(), { once: true });
  }

  static async open(wsUrl: string, config: ProxyConfig, signal?: AbortSignal): Promise<ProxySocket> {
    const Ctor = (config.WebSocket ?? (globalThis as { WebSocket?: unknown }).WebSocket) as
      | (new (url: string) => any)
      | undefined;
    if (typeof Ctor !== "function")
      throw new Error("WebSocket is not available in this runtime (Node < 21 needs a polyfill)");
    const target = `${wsUrl}?auth=${encodeURIComponent(await createToken(config.secret))}`;
    const socket = new Ctor(target);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new DbFailure("unavailable")), config.timeoutMs ?? 15000);
        const done = (error?: unknown) => {
          clearTimeout(timer);
          error ? reject(error) : resolve();
        };
        socket.addEventListener?.("open", () => done());
        socket.addEventListener?.("error", () => done(new DbFailure("unavailable", { issues: ["pgproxy: хендшейк не удался"] })));
        socket.addEventListener?.("close", () => done(new DbFailure("unavailable", { issues: ["pgproxy: сокет закрылся до хендшейка"] })));
      });
    } catch (error) {
      try {
        socket.close?.();
      } catch {
        /* уже закрыт */
      }
      throw error;
    }
    return new ProxySocket(socket, signal);
  }

  #onMessage(raw: string) {
    let frame: ProxyFrame;
    try {
      frame = JSON.parse(raw) as ProxyFrame;
    } catch {
      return;
    }
    if (!frame?.id) return;
    const pending = this.#pending.get(frame.id);
    if (!pending) return;
    this.#pending.delete(frame.id);
    pending.resolve(frame);
  }

  query(statement: Statement): Promise<QueryResult> {
    if (this.#closed) return Promise.reject(new DbFailure("unavailable"));
    const id = requestId();
    return new Promise<ProxyFrame>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.socket.send(JSON.stringify({ id, query: statement.text, params: encodeValues(statement.values) }));
      } catch {
        this.#pending.delete(id);
        reject(new DbFailure("unavailable", { issues: ["pgproxy: отправка в сокет не удалась"] }));
      }
    }).then((frame) => {
      if (frame.id !== id) throw new DbFailure("unavailable", { issues: ["pgproxy: id в ответе не совпал с запросом"] });
      return decodeFrame(frame);
    });
  }

  /** Идемпотентно: сокет закрывают и отмена сигнала, и конец операции — второй раз трогать не надо. */
  #destroy() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.socket.close?.();
    } catch {
      /* уже закрыт */
    }
    for (const pending of this.#pending.values())
      pending.reject(new DbFailure("unavailable", { issues: ["pgproxy: сокет закрыт до ответа"] }));
    this.#pending.clear();
  }

  async close(): Promise<void> {
    this.#destroy();
  }
}

export function proxyWsAdapter(config: ProxyConfig): Driver {
  const { url, timeoutMs, max } = normalize(config, "ws");
  const gate = admission(max, timeoutMs);
  const caps: Capabilities = { ...transactionalCapabilities, sqlstate: false };
  const withSocket = <T>(fn: (socket: ProxySocket) => Promise<T>, signal?: AbortSignal): Promise<T> =>
    gate.run(async (abort) => {
      const socket = await ProxySocket.open(url.toString(), config, signal ?? abort);
      try {
        return await fn(socket);
      } finally {
        await socket.close();
      }
    });
  return {
    capabilities: caps,
    async query<T extends Row>(statement: Statement): Promise<QueryResult<T>> {
      return withSocket((socket) => socket.query(statement) as Promise<QueryResult<T>>, statement.signal);
    },
    async transaction<T>(fn: (tx: Driver) => Promise<T>, options?: TxOptions): Promise<T> {
      return withSocket((socket) =>
        runTransaction((s) => socket.query(s), caps, fn, { ...options, signal: options?.signal ?? undefined }),
      );
    },
    close: gate.close,
  };
}

/** Выбор режима одним вызовом — удобно мульти-транспортным тестам; runtime импортирует ровно один адаптер. */
export function proxyAdapter(mode: ProxyMode, config: ProxyConfig): Driver {
  return mode === "http" ? proxyHttpAdapter(config) : proxyWsAdapter(config);
}
