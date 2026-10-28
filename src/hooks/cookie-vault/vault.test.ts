import type { Cookies } from '@sveltejs/kit'
import { describe, expect, it } from 'vitest'
import { defineForm, field, v } from '#lib/form/index.js'
import { defineCookieVault } from './schema.js'
import {
  readVaultEntries,
  readVaultSnapshot,
  removeVaultEntry,
  resetVaultKey,
  saveVaultEntry,
  slotCookieName,
  VAULT_MASTER_KEY_COOKIE,
} from './vault.server.js'

function createMockCookies(): {
  cookies: Cookies
  jar: Map<string, { value: string; opts: Record<string, unknown> }>
} {
  const jar = new Map<string, { value: string; opts: Record<string, unknown> }>()
  const cookies: Cookies = {
    get(name: string) {
      return jar.get(name)?.value
    },
    getAll() {
      return [...jar.entries()].map(([name, { value }]) => ({ name, value }))
    },
    set(name: string, value: string, opts?: unknown) {
      jar.set(name, { value, opts: (opts as Record<string, unknown> | undefined) ?? {} })
    },
    delete(name: string) {
      jar.delete(name)
    },
    serialize(name: string, value: string) {
      return `${name}=${value}`
    },
    parse() {
      return { name: '', value: '' }
    },
  }
  return { cookies, jar }
}

interface DemoSecretConfig {
  readonly dsn: string
  readonly limitMb: number
}

const demoVault = defineCookieVault<DemoSecretConfig, { limitMb: number }>({
  scope: 'test_s3',
  title: 'Тестовый сейф',
  maxEntries: 2,
  entryForm: defineForm({
    id: 'test_vault_entry',
    fields: {
      slot: field.text({ validate: [v.required()] }),
      dsn: field.text({ validate: [v.required()] }),
    },
  }),
  parse(values) {
    return {
      ok: true,
      id: String(values.slot ?? '').trim(),
      entry: { dsn: String(values.dsn ?? '').trim(), limitMb: 512 },
    }
  },
  mask(id, entry) {
    const u = new URL(entry.dsn)
    return {
      label: id,
      summary: `${u.protocol}//***@${u.host}${u.pathname}`,
      meta: { limitMb: entry.limitMb },
    }
  },
})

describe('универсальный куки-сейф (dv_key + dv_<scope>_<id> AES-256-GCM)', () => {
  it('шифрует каждый слот отдельной HttpOnly-кукой, маскирует секреты в snapshot и блокирует подмену AAD', async () => {
    const { cookies, jar } = createMockCookies()

    const r1 = await saveVaultEntry(cookies, demoVault, 'cloud_a', {
      dsn: 's3://myKeyA:superSecretA@s3.us-east-005.backblazeb2.com/pbseed/demo',
      limitMb: 1024,
    })
    expect(r1.ok).toBe(true)

    // Проверяем, что создалась кука-ключ dv_key и кука слота, обе HttpOnly, без открытого секрета
    const keyCookie = jar.get(VAULT_MASTER_KEY_COOKIE)
    const slotCookie = jar.get(slotCookieName('test_s3', 'cloud_a'))
    expect(keyCookie?.opts.httpOnly).toBe(true)
    expect(slotCookie?.opts.httpOnly).toBe(true)
    expect(slotCookie?.value.includes('superSecretA')).toBe(false)
    expect(slotCookie?.value.includes('myKeyA')).toBe(false)

    // Публичный snapshot не раскрывает логин/пароль
    const snap = await readVaultSnapshot(cookies, demoVault)
    expect(snap.hasKey).toBe(true)
    expect(snap.items).toHaveLength(1)
    expect(snap.items[0]?.summary).toBe(
      's3://***@s3.us-east-005.backblazeb2.com/pbseed/demo',
    )
    expect(JSON.stringify(snap)).not.toContain('superSecretA')

    // Сервер расшифровывает полный конфиг
    const decrypted = await readVaultEntries(cookies, demoVault)
    expect(decrypted.get('cloud_a')?.entry.dsn).toBe(
      's3://myKeyA:superSecretA@s3.us-east-005.backblazeb2.com/pbseed/demo',
    )

    // Попытка скопировать шифротекст под чужое имя куки (подмена слота) отбивается проверкой AAD!
    jar.set(slotCookieName('test_s3', 'cloud_swapped'), {
      value: slotCookie!.value,
      opts: slotCookie!.opts,
    })
    const afterSwap = await readVaultEntries(cookies, demoVault)
    expect(afterSwap.has('cloud_swapped')).toBe(false)

    // Проверка лимита maxEntries (2)
    const r2 = await saveVaultEntry(cookies, demoVault, 'cloud_b', {
      dsn: 's3://k2:s2@acc.r2.cloudflarestorage.com/pbseed',
      limitMb: 2048,
    })
    expect(r2.ok).toBe(true)
    const r3 = await saveVaultEntry(cookies, demoVault, 'cloud_c', {
      dsn: 's3://k3:s3@acc.r2.cloudflarestorage.com/pbseed',
      limitMb: 512,
    })
    expect(r3.ok).toBe(false)

    // Удаление одного слота
    const afterDel = await removeVaultEntry(cookies, demoVault, 'cloud_a')
    expect(afterDel.items.map((x) => x.id)).toEqual(['cloud_b'])

    // Даже если старая кука конфига осталась, сброс/потеря куки-ключа мгновенно делает её нечитаемой
    const savedRawSlot = jar.get(slotCookieName('test_s3', 'cloud_b'))!
    const afterReset = resetVaultKey(cookies, demoVault)
    expect(afterReset.hasKey).toBe(false)
    expect(afterReset.items).toEqual([])

    // Подкладываем обратно старую куку конфига с НОВЫМ ключом — расшифровка обязана вернуть пусто
    jar.set(VAULT_MASTER_KEY_COOKIE, {
      value: Buffer.alloc(32, 7).toString('base64url'),
      opts: { httpOnly: true },
    })
    jar.set(slotCookieName('test_s3', 'cloud_b'), savedRawSlot)
    expect((await readVaultEntries(cookies, demoVault)).size).toBe(0)
  })
})
