import { createCursorCodec } from "../cursor/codec";
import type { CursorCodec } from "../types";

/**
 * Курсор подписывается HMAC-SHA256; ключ — только из runtime-окружения
 * (никогда не `VITE_*`). Пустой секрет = курсор выключён, остальные операции
 * работают (как в источнике).
 *
 * `keys` — кольцо ключей для ротации: старый kid остаётся в словаре, пока
 * ходят выданные ссылки; активный ключ — `activeKey`.
 */
export function cursorCodecFromEnv(
  env: (key: string) => string | undefined,
  options: { ttlSeconds?: number } = {},
): CursorCodec | undefined {
  const secret = env("DB_CURSOR_SECRET");
  if (!secret) return undefined;
  const keys: Record<string, string> = {};
  for (const [kid, value] of Object.entries({
    v1: secret,
    ...Object.fromEntries(
      (env("DB_CURSOR_OLD_KEYS") ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [kid, ...rest] = part.split(":");
          return [kid, rest.join(":")] as const;
        }),
    ),
  }))
    keys[kid] = value as string;
  const ttlSeconds = options.ttlSeconds ?? Number(env("DB_CURSOR_TTL_SECONDS") ?? 1800);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
    throw new Error("Invalid DB_CURSOR_TTL_SECONDS");
  return createCursorCodec({ keys, activeKey: "v1", ttlSeconds });
}
