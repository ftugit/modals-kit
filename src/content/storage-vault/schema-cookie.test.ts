import type { Cookies } from '@sveltejs/kit'
import { describe, expect, it, vi } from 'vitest'
import { componentFormRegistry } from '#hooks/component-form/registry.js'
import { readVaultEntries, slotCookieName, VAULT_MASTER_KEY_COOKIE } from '#hooks/cookie-vault/vault.server.js'
import { STORAGE_SERVER_VAULT_FORM_ID } from '#hooks/storage-server-form/index.js'
import { storageVaultSchema } from './schema.js'

// Фиксированный тестовый режим старого формата v1 без серверного секрета.
// Сетевая проверка внешнего S3 не входит в этот тест; её контракт тестируется отдельно.
vi.mock('$app/env/private', async (importOriginal) => ({
  ...await importOriginal<typeof import('$app/env/private')>(),
  AUTH_SEAL_SECRET: '',
  AUTH_COOKIE_SAMESITE: 'lax',
}))
vi.mock('#server/storage-probe.server.js', () => ({
  probeStorageVaultEntry: vi.fn(async () => ({ ok: true })),
  validateStorageTargetUrl: vi.fn(),
}))

function cookieJar() {
  const jar = new Map<string, { value: string; opts: Record<string, unknown> }>()
  const cookies: Cookies = {
    get: (name) => jar.get(name)?.value,
    getAll: () => [...jar].map(([name, item]) => ({ name, value: item.value })),
    set: (name, value, options) => { jar.set(name, { value, opts: options as unknown as Record<string, unknown> }) },
    delete: (name) => { jar.delete(name) },
    serialize: (name, value) => `${name}=${value}`,
    parse: () => ({ name: '', value: '' }),
  }
  return { cookies, jar }
}

const values = {
  slot: 's3_main', url: 's3://key:secret@s3.example.com/bucket/app',
  storage_mb: '8', file_mb: '2',
}

/** Сформировать v1-куку независимо от saveVaultEntry с прежней сериализацией и AAD. */
async function legacyCookie(key: Uint8Array<ArrayBuffer>, encryptionKey: string): Promise<string> {
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const iv = new Uint8Array(12).fill(7)
  const entry = { url: values.url, storageMb: 8, fileMb: 2, readOnly: false, allowSplit: true, encryptionKey }
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, updatedAt: '2025-01-01T00:00:00.000Z', entry }))
  const additionalData = new TextEncoder().encode('modals-kit:dv:v1:storage:s3_main')
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, aes, payload))
  return `v1.${Buffer.concat([iv, encrypted]).toString('base64url')}`
}

describe('storage vault: сохранение и совместимость куки', () => {
  it('читает независимо созданную v1-куку с прежним ключом с C0', async () => {
    const { cookies, jar } = cookieJar()
    const raw = new Uint8Array(32).fill(42)
    jar.set(VAULT_MASTER_KEY_COOKIE, { value: Buffer.from(raw).toString('base64url'), opts: {} })
    jar.set(slotCookieName('storage', 's3_main'), { value: await legacyCookie(raw, 'abcd\u0001efgh'), opts: {} })
    const entries = await readVaultEntries(cookies, storageVaultSchema)
    expect(entries.get('s3_main')?.entry.encryptionKey).toBe('abcd\u0001efgh')
    expect(entries.get('s3_main')?.updatedAt).toBe('2025-01-01T00:00:00.000Z')
  })

  it('обработчик формы создаёт и заменяет слот, не меняя мягкий контракт ключа', async () => {
    // Загрузка реального серверного модуля регистрирует обработчик формы сейфа.
    await import('./vault.form.server.js')
    const reg = componentFormRegistry().get(STORAGE_SERVER_VAULT_FORM_ID)
    expect(reg).toBeDefined()
    if (!reg) return
    const { cookies, jar } = cookieJar()
    const event = { cookies, url: new URL('https://example.test/upload-demo/vault') } as Parameters<typeof reg.execute>[1]
    const save = async (encryptionKey: string) => {
      const commit = vi.fn()
      const fail = vi.fn(() => { throw new Error('unexpected validation failure') })
      const ctx = { values: { ...values, encryption_key: encryptionKey }, intent: 'submit', commit, fail } as unknown as Parameters<typeof reg.execute>[0]
      await reg.execute(ctx, event)
      expect(commit).toHaveBeenCalledOnce()
      expect(fail).not.toHaveBeenCalled()
    }

    await save('abcd\u0001efgh')
    const master = jar.get(VAULT_MASTER_KEY_COOKIE)
    const firstCipher = jar.get(slotCookieName('storage', 's3_main'))
    expect(master?.opts.httpOnly).toBe(true)
    expect(firstCipher?.opts.httpOnly).toBe(true)
    expect(firstCipher?.opts.secure).toBe(true)
    expect((await readVaultEntries(cookies, storageVaultSchema)).get('s3_main')?.entry.encryptionKey).toBe('abcd\u0001efgh')

    await save('abcd\u007fefgh')
    expect(jar.get(VAULT_MASTER_KEY_COOKIE)?.value).toBe(master?.value)
    expect(jar.get(slotCookieName('storage', 's3_main'))?.value).not.toBe(firstCipher?.value)
    expect((await readVaultEntries(cookies, storageVaultSchema)).get('s3_main')?.entry.encryptionKey).toBe('abcd\u007fefgh')

    const savedCipher = jar.get(slotCookieName('storage', 's3_main'))?.value
    const reject = vi.fn(() => ({ status: 'invalid' }))
    const commit = vi.fn()
    const invalid = { values: { ...values, encryption_key: 'short' }, intent: 'submit', commit, fail: reject } as unknown as Parameters<typeof reg.execute>[0]
    await reg.execute(invalid, event)
    expect(reject).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(jar.get(slotCookieName('storage', 's3_main'))?.value).toBe(savedCipher)
    expect((await readVaultEntries(cookies, storageVaultSchema)).get('s3_main')?.entry.encryptionKey).toBe('abcd\u007fefgh')

    // В сейфе это полная замена слота: пустой ключ удаляется, не сохраняется как в пуле.
    await save('')
    expect((await readVaultEntries(cookies, storageVaultSchema)).get('s3_main')?.entry.encryptionKey).toBeUndefined()
  })
})
