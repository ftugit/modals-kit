/**
 * Изоморфная криптография связки ключей (ход 251): генерация, подписание
 * приватным, проверка публичным (seed) — без передачи секрета. Тот же код
 * пойдёт в браузер юзера с JS.
 */
import { describe, expect, test } from 'vitest'
import { generateKeyPair, sign, verify } from './keys.js'

describe('связка ключей (WebCrypto Ed25519)', () => {
  test('генерация: seed — 43 символа base64url (32 байта), secret длиннее', async () => {
    const { seed, secret } = await generateKeyPair()
    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secret.length).toBeGreaterThan(43)
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('подпись приватным → проверка публичным (seed): true; секрет не нужен', async () => {
    const { seed, secret } = await generateKeyPair()
    const signature = await sign('nonce:abc-123', secret)
    expect(await verify('nonce:abc-123', signature, seed)).toBe(true)
  })

  test('чужой payload или чужой seed — false', async () => {
    const a = await generateKeyPair()
    const b = await generateKeyPair()
    const signature = await sign('payload', a.secret)
    expect(await verify('payload-другой', signature, a.seed)).toBe(false)
    expect(await verify('payload', signature, b.seed)).toBe(false)
  })

  test('мусор вместо подписи или seed — false, без броска (факт auth.signature)', async () => {
    const { seed, secret } = await generateKeyPair()
    const signature = await sign('payload', secret)
    expect(await verify('payload', 'не-подпись', seed)).toBe(false)
    expect(await verify('payload', signature, 'не-seed')).toBe(false)
    expect(await verify('payload', '!!!', '!!!')).toBe(false)
  })

  test('подписи детерминированы и коротки (64 байта → 86 символов base64url)', async () => {
    const { seed, secret } = await generateKeyPair()
    const a = await sign('payload', secret)
    const b = await sign('payload', secret)
    expect(a).toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{86}$/)
  })
})
