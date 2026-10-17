/**
 * Криптография seed-модели — изоморфный WebCrypto (Ed25519): один и тот же
 * код работает и на сервере, и у клиента. По плану (auth-seed.md §1) у юзера
 * с JS генерация связки и подписание challenge выполняются в браузере —
 * приватный ключ не покидает устройство; сервер знает только seed (публичный)
 * и проверяет подпись им же (`verify` не принимает секрет).
 *
 * Формат — base64url без паддинга. seed = raw-ключ (32 байта → 43 символа,
 * как в `schema.ts`); secret = pkcs8 (WebCrypto не импортирует raw как
 * приватный ключ Ed25519). В БД хранится только seed.
 */

const ED25519 = { name: 'Ed25519' } as const
const enc = new TextEncoder()

/** Связка ключей: seed (публичный) + secret (приватный, не для сервера). */
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

/** Генерация связки: у клиента с JS — в браузере, seed уходит на сервер один раз (регистрация). */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair
  const [seed, secret] = await Promise.all([
    crypto.subtle.exportKey('raw', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ])
  return { seed: toBase64Url(new Uint8Array(seed)), secret: toBase64Url(new Uint8Array(secret)) }
}

/** Подпись приватным ключом — локально у владельца; наружу уходит только подпись. */
export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', fromBase64Url(secret), ED25519, false, ['sign'])
  return toBase64Url(new Uint8Array(await crypto.subtle.sign(ED25519, key, enc.encode(payload))))
}

/**
 * Проверка публичным (seed): приватный ключ в проверке не участвует ни в каком
 * виде. Мусор вместо ключа или подписи — `false`, а не бросок: для ядра это
 * факт `auth.signature`, а не сбой.
 */
export async function verify(payload: string, signature: string, seed: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64Url(seed), ED25519, false, ['verify'])
    return await crypto.subtle.verify(ED25519, key, fromBase64Url(signature), enc.encode(payload))
  } catch {
    return false
  }
}
