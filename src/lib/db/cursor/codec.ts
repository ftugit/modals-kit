import { fail } from "../errors";
import type { CursorCodec } from "../types";
/** Канонизация для привязки cursor к policy, пользователю и параметрам выборки. */
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return fail("validation");
}
const encoder = new TextEncoder();
function encode(b: Uint8Array): string {
  let s = "";
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decode(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(s)) fail("cursor");
  const b = atob(
    s.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (s.length % 4)) % 4),
  );
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
/**
 * Продление указателя (live-update §7 «б»): просроченный, но ПОДЛИННЫЙ токен
 * принимается в пределах максимального возраста, а следующий ответ выдаёт
 * свежий. Сам срок жизни (`exp`) при этом остаётся коротким — продлевает не
 * кодек, а ответ (переподпись закладки, `CursorPage.beginCursor`).
 *
 * `maxAgeSeconds` — жёсткий потолок от момента ВЫПУСКА (`iat`): трогай токен
 * сколько угодно, дальше него он не живёт. Не задан — равен `ttlSeconds`, то
 * есть поведение прежнее: продления нет, срок жизни = сроку жизни.
 */
export function createCursorCodec(config: {
  keys: Readonly<Record<string, string>>;
  activeKey: string;
  ttlSeconds: number;
  maxAgeSeconds?: number;
  now?: () => number;
}): CursorCodec {
  const maxAgeSeconds = config.maxAgeSeconds ?? config.ttlSeconds;
  if (
    !config.keys[config.activeKey] ||
    Object.values(config.keys).some((k) => encoder.encode(k).length < 32) ||
    !Number.isInteger(config.ttlSeconds) ||
    config.ttlSeconds < 1 ||
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < config.ttlSeconds
  )
    throw new Error("Invalid cursor key/TTL configuration");
  const now = config.now ?? (() => Date.now());
  const nowSeconds = () => Math.floor(now() / 1000);
  const key = (secret: string) =>
    crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  const digest = async (scope: unknown) =>
    encode(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(canonical(scope))),
      ),
    );
  return {
    async encode(scope, values) {
      const iat = nowSeconds();
      const kidPart = encode(encoder.encode(config.activeKey));
      const bodyPart = encode(
        encoder.encode(
          JSON.stringify({
            v: 1,
            kid: config.activeKey,
            // `iat` — момент выпуска: от него отсчитывается максимальный возраст.
            // Старые токены его не несут — для них возраст считается как
            // `exp - ttl` (см. `decode`).
            iat,
            exp: Math.min(iat + config.ttlSeconds, iat + maxAgeSeconds),
            scope: await digest(scope),
            values,
          }),
        ),
      );
      const signingInput = encoder.encode(kidPart + "." + bodyPart);
      const mac = await crypto.subtle.sign(
        "HMAC",
        await key(config.keys[config.activeKey]),
        signingInput,
      );
      const token = kidPart + "." + bodyPart + "." + encode(new Uint8Array(mac));
      if (token.length > 8192) fail("cursor");
      return token;
    },
    async decode(token, scope) {
      try {
        if (typeof token !== "string" || token.length > 8192) fail("cursor");
        const parts = token.split(".");
        if (parts.length !== 3 || parts[0].length > 128) fail("cursor");
        const kid = new TextDecoder("utf-8", { fatal: true }).decode(
          decode(parts[0]),
        );
        if (
          !kid ||
          !Object.prototype.hasOwnProperty.call(config.keys, kid)
        )
          fail("cursor");
        const body = decode(parts[1]),
          mac = decode(parts[2]);
        const signingInput = encoder.encode(parts[0] + "." + parts[1]);
        if (
          !(await crypto.subtle.verify(
            "HMAC",
            await key(config.keys[kid]),
            mac,
            signingInput,
          ))
        )
          fail("cursor");
        const p = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
        if (
          p.v !== 1 ||
          p.kid !== kid ||
          !Number.isSafeInteger(p.exp) ||
          !Array.isArray(p.values) ||
          (p.iat !== undefined && (!Number.isSafeInteger(p.iat) || p.iat < 0))
        )
          fail("cursor");
        // Момент выпуска: у токенов без `iat` его даёт срок жизни — `exp - ttl`.
        // Небольшая неточность (ttl поменяли между выпуском и чтением) безопасна:
        // она сдвигает потолок, но подпись и `scope` проверяются как обычно.
        const iat = p.iat === undefined ? p.exp - config.ttlSeconds : (p.iat as number);
        const nowSec = nowSeconds();
        // Просрочен — но пока не старше максимального возраста: принимаем
        // (§7 «б»). Свежий ответ переподпишет закладку.
        if (p.exp <= nowSec && iat + maxAgeSeconds <= nowSec) fail("cursor");
        if (p.scope !== (await digest(scope))) fail("cursor");
        return p.values;
      } catch {
        return fail("cursor");
      }
    },
  };
}
