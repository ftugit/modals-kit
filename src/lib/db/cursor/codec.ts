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
export function createCursorCodec(config: {
  keys: Readonly<Record<string, string>>;
  activeKey: string;
  ttlSeconds: number;
  now?: () => number;
}): CursorCodec {
  if (
    !config.keys[config.activeKey] ||
    Object.values(config.keys).some((k) => encoder.encode(k).length < 32) ||
    !Number.isInteger(config.ttlSeconds) ||
    config.ttlSeconds < 1
  )
    throw new Error("Invalid cursor key/TTL configuration");
  const now = config.now ?? (() => Date.now());
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
      const body = encoder.encode(
        JSON.stringify({
          v: 1,
          kid: config.activeKey,
          exp: Math.floor(now() / 1000) + config.ttlSeconds,
          scope: await digest(scope),
          values,
        }),
      );
      const mac = await crypto.subtle.sign(
        "HMAC",
        await key(config.keys[config.activeKey]),
        body,
      );
      const token = encode(body) + "." + encode(new Uint8Array(mac));
      if (token.length > 8192) fail("cursor");
      return token;
    },
    async decode(token, scope) {
      try {
        if (typeof token !== "string" || token.length > 8192) fail("cursor");
        const parts = token.split(".");
        if (parts.length !== 2) fail("cursor");
        const body = decode(parts[0]),
          mac = decode(parts[1]);
        const p = JSON.parse(new TextDecoder().decode(body));
        if (
          p.v !== 1 ||
          typeof p.kid !== "string" ||
          !Object.prototype.hasOwnProperty.call(config.keys, p.kid) ||
          !Number.isSafeInteger(p.exp) ||
          p.exp <= Math.floor(now() / 1000) ||
          !Array.isArray(p.values)
        )
          fail("cursor");
        if (
          !(await crypto.subtle.verify(
            "HMAC",
            await key(config.keys[p.kid]),
            mac,
            body,
          )) ||
          p.scope !== (await digest(scope))
        )
          fail("cursor");
        return p.values;
      } catch {
        return fail("cursor");
      }
    },
  };
}
