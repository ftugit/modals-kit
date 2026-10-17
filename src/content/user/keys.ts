/**
 * Криптография seed-модели — `@noble/ed25519` (семья noble, без зависимостей:
 * SHA-512 для async-методов берёт из WebCrypto; ~3,5 КиБ gzip, когда попадёт
 * в чанк роута входа). Один и тот же код работает на сервере и у клиента:
 * по плану (auth-seed.md §1) связку генерирует приложение (у юзера с JS —
 * в браузере), login ждёт конечный публичный ключ (seed); приватный не
 * покидает устройство, сервер проверяет подпись публичным.
 *
 * Формат — base64url без паддинга: secret и seed — ровно 32 байта (43
 * символа). Публичный выводится из приватного детерминированно (`seedOf`),
 * поэтому хранить нужно одно значение — secret; seed восстанавливается где
 * угодно. В БД хранится только seed.
 */
import * as ed from '@noble/ed25519'

/** Связка: secret (приватный, не для сервера) + seed (публичный, «логин»). */
export type KeyPair = { seed: string; secret: string }

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Генерация связки: у клиента с JS — в браузере; наружу уходит только seed (регистрация). */
export async function generateKeyPair(): Promise<KeyPair> {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  return { secret: toBase64Url(secret), seed: toBase64Url(await ed.getPublicKeyAsync(secret)) }
}

/** Публичный (seed) из приватного — детерминированно, всегда один и тот же. */
export async function seedOf(secret: string): Promise<string> {
  return toBase64Url(await ed.getPublicKeyAsync(fromBase64Url(secret)))
}

/** Подпись приватным — локально у владельца; наружу уходит только подпись. */
export async function sign(payload: string, secret: string): Promise<string> {
  return toBase64Url(await ed.signAsync(new TextEncoder().encode(payload), fromBase64Url(secret)))
}

/**
 * Проверка публичным (seed): приватный ключ в проверке не участвует ни в каком
 * виде. Мусор вместо ключа или подписи — `false`, а не бросок: для ядра это
 * факт `auth.signature`, а не сбой.
 */
export async function verify(payload: string, signature: string, seed: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      fromBase64Url(signature),
      new TextEncoder().encode(payload),
      fromBase64Url(seed),
    )
  } catch {
    return false
  }
}
