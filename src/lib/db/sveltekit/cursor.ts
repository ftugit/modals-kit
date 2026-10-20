import { createCursorCodec } from "../cursor/codec";
import type { CursorCodec } from "../types";

const KID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Курсор подписывается HMAC-SHA256; ключ — только из runtime-окружения
 * (никогда не `VITE_*`). Пустой секрет = курсор выключён, остальные операции
 * работают (как в источнике).
 *
 * Ротация (DB-1): у действующего секрета есть имя `DB_CURSOR_KID` (по умолчанию `v1`),
 * оно пишется в каждый токен. Смена секрета: новое имя в `DB_CURSOR_KID`, новый секрет
 * в `DB_CURSOR_SECRET`, прежний — в `DB_CURSOR_OLD_KEYS` под ПРЕЖНИМ именем
 * (`v1:старый`): выданные ссылки проверяются им, новые подписываются новым.
 * Имя действующего ключа в старых — ошибка: иначе одно из двух молча перекрыло бы другое.
 */
export function cursorCodecFromEnv(
  env: (key: string) => string | undefined,
  options: { ttlSeconds?: number; maxAgeSeconds?: number } = {},
): CursorCodec | undefined {
  const secret = env("DB_CURSOR_SECRET");
  if (!secret) return undefined;
  const activeKey = env("DB_CURSOR_KID") || "v1";
  if (!KID.test(activeKey))
    throw new Error(`DB_CURSOR_KID: ожидалось имя из латиницы, цифр, «_» и «-» (до 32 символов), получено «${activeKey}»`);
  const keys: Record<string, string> = { [activeKey]: secret };
  for (const part of (env("DB_CURSOR_OLD_KEYS") ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const cut = part.indexOf(":");
    const kid = cut > 0 ? part.slice(0, cut) : "";
    const value = cut > 0 ? part.slice(cut + 1) : "";
    if (!KID.test(kid) || !value)
      throw new Error("DB_CURSOR_OLD_KEYS: ожидался формат kid:secret через запятую");
    if (kid === activeKey)
      throw new Error(
        `DB_CURSOR_OLD_KEYS: имя «${kid}» занято действующим ключом (DB_CURSOR_KID). ` +
          "При смене секрета дайте новому ключу новое имя в DB_CURSOR_KID, а прежний оставьте под старым",
      );
    if (Object.prototype.hasOwnProperty.call(keys, kid))
      throw new Error(`DB_CURSOR_OLD_KEYS: имя «${kid}» повторяется`);
    keys[kid] = value;
  }
  const ttlSeconds = options.ttlSeconds ?? Number(env("DB_CURSOR_TTL_SECONDS") ?? 1800);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
    throw new Error("Invalid DB_CURSOR_TTL_SECONDS");
  // Максимальный возраст указателя (live-update §7 «б»): просроченный, но
  // подлинный токен принимается, пока ему не больше этого срока. По умолчанию —
  // неделя: ссылка на порцию переживает простой и продлевается каждым заходом,
  // а потолок не даёт ей жить вечно.
  const maxAgeSeconds =
    options.maxAgeSeconds ?? Number(env("DB_CURSOR_MAX_AGE_SECONDS") ?? 7 * 24 * 3600);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < ttlSeconds)
    throw new Error(
      `DB_CURSOR_MAX_AGE_SECONDS: ожидалось целое не меньше DB_CURSOR_TTL_SECONDS (${ttlSeconds}), получено «${maxAgeSeconds}»`,
    );
  return createCursorCodec({ keys, activeKey, ttlSeconds, maxAgeSeconds });
}
