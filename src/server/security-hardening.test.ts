import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { localPath } from '#lib/address/index.js'
import { conservativeLimits, createCursorCodec, createDb } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import {
  issueChallenge,
  login,
  MAX_ACTIVE_SESSIONS_PER_USER,
  subnetHash,
} from '#content/user/auth.js'
import { createUserConfig } from '#content/user/config.js'
import { generateKeyPair, sign, verify } from '#content/user/keys.js'
import type { AuthPorts, AuthRow } from '#content/user/ports.js'
import {
  auth as authResource,
  config as configResource,
  profile as profileResource,
  session as sessionResource,
} from '#content/user/schema.js'
import type { SessionRecord } from '#content/user/types.js'
import { saveVaultEntry, slotCookieName } from '#hooks/cookie-vault/vault.server.js'
import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { variables as envVariables } from '../env.js'
import { securityHeadersHandle } from '../hooks.server.js'
import { localStore } from './cache.server.js'
import { clientIpOf, subnetFromIp, subnetOfEvent } from './client-ip.server.js'
import { originGuard } from './form-security.server.js'
import { createSafeStorageFetch, isBlockedIpAddress } from './safe-storage-fetch.server.js'
import { cspDirectives, trustedOrigins } from './trusted-origins.js'

function makeMemoryAuthPorts(withNonceRegistry = true) {
  const sessions = new Map<string, SessionRecord>()
  const auths = new Map<string, AuthRow>()
  const seenNonces = new Set<string>()
  let now = 1_700_000_000_000

  const ports: AuthPorts = {
    sessions: {
      async create(r) {
        sessions.set(r.jti, { ...r })
      },
      async get(jti) {
        return sessions.get(jti)
      },
      async listByAuth(authId) {
        return [...sessions.values()].filter((s) => s.authId === authId)
      },
      async save(r) {
        sessions.set(r.jti, { ...r })
      },
      async softDelete(jti, at) {
        const cur = sessions.get(jti)
        if (cur) sessions.set(jti, { ...cur, deletedAt: at })
      },
      async softDeleteAllByAuth(authId, at) {
        for (const [k, v] of sessions) {
          if (v.authId === authId) sessions.set(k, { ...v, deletedAt: at })
        }
      },
    },
    auths: {
      async findBySeed(seed) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt === null)
      },
      async findDeletedBySeed(seed) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt !== null)
      },
      async create(seed) {
        if ([...auths.values()].some((r) => r.seed === seed)) return null
        const row: AuthRow = {
          id: crypto.randomUUID(),
          seed,
          deletedAt: null,
          permissions: [],
          subnetSalt: 'salt-1234567890',
        }
        auths.set(row.id, row)
        return row
      },
      async get(id) {
        return auths.get(id)
      },
      async markDeleted(id, at) {
        const cur = auths.get(id)
        if (cur) auths.set(id, { ...cur, deletedAt: at })
      },
      async clearDeleted(id) {
        const cur = auths.get(id)
        if (cur) auths.set(id, { ...cur, deletedAt: null })
      },
      async wipeCredentials(id) {
        const cur = auths.get(id)
        if (cur) auths.set(id, { ...cur, seed: null })
      },
      async listDeletedBefore(cutoff) {
        return [...auths.values()].filter((r) => r.deletedAt !== null && r.deletedAt <= cutoff)
      },
      async setPermissions(_ctx, id, perms) {
        const cur = auths.get(id)
        if (cur) auths.set(id, { ...cur, permissions: [...perms] })
      },
      async listPage() {
        return { rows: [], total: 0 }
      },
    },
    profiles: {
      async get() {
        return undefined
      },
      async create() {},
      async update() {},
      async remove() {},
    },
    sealKeys: {
      current: () => ({ id: 'k1', secret: 'x'.repeat(32) }),
      secretOf: () => 'x'.repeat(32),
      retire: async () => {},
    },
    seal: {
      async seal(payload) {
        return Buffer.from(JSON.stringify(payload)).toString('base64url')
      },
      async unseal(token) {
        try {
          return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
        } catch {
          return undefined
        }
      },
    },
    crypto: { sign, verify },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    clock: { now: () => now },
    config: createUserConfig(localStore.scope(`sec-test-${crypto.randomUUID()}`)),
    settings: {
      row: async () => undefined,
      defaults: async () => [],
      anyUserRow: async () => false,
      insert: async () => {},
      update: async () => {},
      remove: async () => {},
      cache: localStore.scope(`sec-cfg-${crypto.randomUUID()}`),
    },
    blocks: {
      listByTarget: async () => [],
      listByTargets: async () => [],
      listPage: async () => ({ rows: [], total: 0 }),
      getById: async () => undefined,
      insert: async () => {},
      update: async () => {},
      remove: async () => {},
    },
    subnetPepper: 'server-secret-pepper-0123456789abcdef',
    ...(withNonceRegistry
      ? {
          nonces: {
            async consume(nonce) {
              if (seenNonces.has(nonce)) return false
              seenNonces.add(nonce)
              return true
            },
          },
        }
      : {}),
  }

  return {
    ports,
    sessions,
    advanceClock(ms: number) {
      now += ms
    },
  }
}

describe('Security Hardening S1–S7 & S9–S12', () => {
  it('S1 + S7: требует обязательную подпись Ed25519, сжигает challenge.n после успешного входа и ограничивает число активных сессий', async () => {
    const { ports, sessions, advanceClock } = makeMemoryAuthPorts(true)
    const kp = await generateKeyPair()
    const ch = await issueChallenge(ports)
    expect(ch.ok).toBe(true)
    if (!ch.ok) return

    // 1. Попытка без подписи строго отклоняется (S1) и НЕ сжигает challenge.n
    const noSig = await login(ports, {
      seed: kp.seed,
      challenge: ch.value.token,
      signature: '',
    })
    expect(noSig.ok).toBe(false)
    if (!noSig.ok) expect(noSig.fact.code).toBe('auth.signature')

    // 2. Первый вход с валидной подписью проходит и атомарно гасит challenge.n
    const validSig = await sign(ch.value.token, kp.secret)
    const first = await login(ports, {
      seed: kp.seed,
      challenge: ch.value.token,
      signature: validSig,
    })
    expect(first.ok).toBe(true)

    // 3. Повторное воспроизведение той же пары (replay) блокируется с auth.nonce-unknown (S7)
    const replay = await login(ports, {
      seed: kp.seed,
      challenge: ch.value.token,
      signature: validSig,
    })
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.fact.code).toBe('auth.nonce-unknown')

    // 4. Потолок активных сессий (MAX_ACTIVE_SESSIONS_PER_USER = 50): лишние старые вытесняются
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER + 4; i++) {
      advanceClock(1000)
      const nextCh = await issueChallenge(ports)
      if (!nextCh.ok) throw new Error('challenge failed')
      const res = await login(ports, {
        seed: kp.seed,
        challenge: nextCh.value.token,
        signature: await sign(nextCh.value.token, kp.secret),
      })
      expect(res.ok).toBe(true)
    }
    const activeCount = [...sessions.values()].filter((s) => s.deletedAt === null).length
    expect(activeCount).toBe(MAX_ACTIVE_SESSIONS_PER_USER)
  })

  it('S2 + S9: prod trustedOrigins не включает localhost, wildcard не обходится через @userinfo, собственный origin всегда разрешён, а PREVIEW_PORTS не снимает frame-ancestors', () => {
    const prodOrigins = trustedOrigins(() => undefined, { dev: false })
    expect(prodOrigins.exact).toEqual([])

    const withWildcard = trustedOrigins(
      (k) => (k === 'KIT_TRUSTED_ORIGINS' ? 'https://*.e2b.app/' : undefined),
      { dev: false },
    )
    expect(withWildcard.patterns).toHaveLength(1)
    expect(withWildcard.patterns[0]!.test('https://5173-sbx.e2b.app')).toBe(true)
    expect(withWildcard.patterns[0]!.test('https://5173-sbx.e2b.app@evil.example')).toBe(false)
    expect(withWildcard.patterns[0]!.test('https://5173-sbx.e2b.app/path')).toBe(false)

    // Собственный origin всегда проходит через originGuard
    const ownVerdict = originGuard({
      request: new Request('https://app.prod.example/auth', {
        method: 'POST',
        headers: { origin: 'https://app.prod.example' },
      }),
      url: new URL('https://app.prod.example/auth'),
    } as never)
    expect(ownVerdict).toBeUndefined()

    // S9: PREVIEW_PORTS сам по себе не убирает frame-ancestors 'none' в проде
    const cspWithPorts = cspDirectives({
      get: (k) => (k === 'PREVIEW_PORTS' ? '5173,5174' : undefined),
      dev: false,
    })
    expect(cspWithPorts['frame-ancestors']).toEqual(['none'])
  })

  it('S3: createSafeStorageFetch закрепляет DNS-ответ (1 lookup без TOCTOU rebinding) и блокирует редирект на метаданные облака', async () => {
    expect(isBlockedIpAddress('169.254.169.254', true)).toBe(true)
    expect(isBlockedIpAddress('100.100.100.200', true)).toBe(true)
    expect(isBlockedIpAddress('::ffff:127.0.0.1', false)).toBe(true)
    expect(isBlockedIpAddress('100.64.0.10', false)).toBe(true)
    expect(isBlockedIpAddress('fd00:ec2::254', true)).toBe(true)

    // Проверяем реальный локальный HTTP-сервер с DNS-pinning: ровно 1 вызов dnsResolver!
    const srv = createServer((req, res) => {
      if (req.url === '/redirect-imds') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`host:${req.headers.host}`)
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const addr = srv.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    try {
      let lookupCalls = 0
      const pinnedFetch = createSafeStorageFetch({
        allowLocalNetwork: true,
        dnsResolver: async () => {
          lookupCalls++
          // Даже если бы второй DNS-запрос вернул 169.254.169.254, повторного вызова не происходит!
          return [{ address: lookupCalls === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }]
        },
      })

      const okRes = await pinnedFetch(`http://storage.example.test:${port}/ok`)
      expect(okRes.status).toBe(200)
      expect(await okRes.text()).toBe(`host:storage.example.test:${port}`)
      expect(lookupCalls).toBe(1)

      // Редирект на cloud metadata обязан блокироваться
      await expect(
        pinnedFetch(`http://storage.example.test:${port}/redirect-imds`),
      ).rejects.toThrow(/SSRF|заблокирован/i)
    } finally {
      srv.close()
    }
  })

  it('S4: saveVaultEntry включает флаг Secure для HTTPS-запросов даже при обычном SameSite=Lax', async () => {
    const written = new Map<string, { value: string; opts: Record<string, unknown> }>()
    const cookies = {
      get: (name: string) => written.get(name)?.value,
      getAll: () => [...written.entries()].map(([name, v]) => ({ name, value: v.value })),
      set: (name: string, value: string, opts: Record<string, unknown>) => {
        written.set(name, { value, opts })
      },
      delete: (name: string) => {
        written.delete(name)
      },
      serialize: () => '',
    }

    const res = await saveVaultEntry(
      cookies as never,
      storageVaultSchema,
      's3_https',
      {
        url: 's3://key:secret@s3.eu-central-1.amazonaws.com/bucket',
        storageMb: 512,
        fileMb: 64,
        readOnly: false,
        allowSplit: true,
      },
      { secure: true },
    )
    expect(res.ok).toBe(true)
    expect(written.get('dv_key')?.opts.secure).toBe(true)
    expect(written.get(slotCookieName(storageVaultSchema.scope, 's3_https'))?.opts.secure).toBe(
      true,
    )
  })

  it('S5: jti, version и subnet_salt скрыты от клиентского чтения в БД (read: server), а subnetHash использует HMAC с pepper', async () => {
    const h1 = await subnetHash('salt-a', '203.0.113.0', 'pepper-1')
    const h2 = await subnetHash('salt-a', '203.0.113.0', 'pepper-2')
    expect(h1).toHaveLength(64)
    expect(h1).not.toBe(h2)

    const pg = new PGlite()
    try {
      const driver = pgliteAdapter(pg)
      const resources = [profileResource, authResource, sessionResource, configResource]
      const schema = defineSchema({ resources })
      const report = await schema.sync(driver)
      expect(report.status).toBe('ok')
      const db = createDb({ driver, limits: conservativeLimits, resources })

      const serverCtx = { principal: { roles: ['server'] } }
      const createdAuth = await db.resource(authResource).insert(serverCtx, {
        seed: 'B'.repeat(43),
      })
      const uid = String(createdAuth.id)
      await db.resource(sessionResource).insert(serverCtx, {
        auth_id: uid,
        jti: 'jti-secret-token-value-123456',
        version: 3,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })

      const ownerCtx = { principal: { id: uid, roles: [] } }
      const ownerAuthRows = await db.resource(authResource).select(ownerCtx, {})
      expect(ownerAuthRows).toHaveLength(1)
      expect('subnet_salt' in ownerAuthRows[0]!).toBe(false)

      const ownerSessionRows = await db.resource(sessionResource).select(ownerCtx, {})
      expect(ownerSessionRows).toHaveLength(1)
      expect('jti' in ownerSessionRows[0]!).toBe(false)
      expect('version' in ownerSessionRows[0]!).toBe(false)

      // Серверный адаптер по-прежнему видит служебные поля
      const serverSessionRows = await db.resource(sessionResource).select(serverCtx, {})
      expect(serverSessionRows[0]!.jti).toBe('jti-secret-token-value-123456')
      expect(serverSessionRows[0]!.version).toBe(3)
    } finally {
      await pg.close()
    }
  })

  it('S6: clientIpOf берёт event.getClientAddress(), игнорирует поддельный X-Forwarded-For и канонизирует IPv4-mapped / IPv6 /48', () => {
    const req = new Request('https://app.example/auth', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    const event = {
      request: req,
      getClientAddress: () => '::ffff:198.51.100.42',
    }
    expect(clientIpOf(event, req)).toBe('198.51.100.42')
    expect(subnetOfEvent(event, req)).toBe('198.51.100.0')
    expect(subnetFromIp('2001:db8:abcd:0012::1')).toBe('2001:db8:abcd::')
    expect(subnetFromIp('not-an-ip"><script>')).toBeUndefined()
  })

  it('S9: securityHeadersHandle выставляет защитные заголовки и включает HSTS только на https:', async () => {
    const httpRes = await securityHeadersHandle({
      event: { url: new URL('http://localhost:5173/') } as never,
      resolve: async () => new Response('ok'),
    })
    expect(httpRes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(httpRes.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(httpRes.headers.get('permissions-policy')).toContain('camera=()')
    expect(httpRes.headers.get('strict-transport-security')).toBeNull()

    const httpsRes = await securityHeadersHandle({
      event: { url: new URL('https://app.example/') } as never,
      resolve: async () => new Response('ok'),
    })
    expect(httpsRes.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains',
    )
  })

  it('S10 + S11 + S12: env отклоняет короткие секреты при сохранении пустого значения, курсор проверяет HMAC до JSON.parse, а localPath режет /\\evil', async () => {
    // S10: пустые секреты разрешены (secret-free build), короткие < 32 отвергаются
    expect(envVariables.AUTH_SEAL_SECRET.schema['~standard'].validate('')).toEqual({
      value: undefined,
    })
    expect(
      'issues' in
        (await envVariables.AUTH_SEAL_SECRET.schema['~standard'].validate('too-short')),
    ).toBe(true)
    expect(
      'issues' in
        (await envVariables.DB_CURSOR_SECRET.schema['~standard'].validate('short-cursor-key')),
    ).toBe(true)
    expect(
      'issues' in
        (await envVariables.AUTH_SEAL_OLD_KEYS.schema['~standard'].validate('old1:short')),
    ).toBe(true)
    expect(
      await envVariables.AUTH_SEAL_OLD_KEYS.schema['~standard'].validate(
        `old1:${'k'.repeat(32)}`,
      ),
    ).toEqual({ value: `old1:${'k'.repeat(32)}` })

    // S11: формат <kidB64>.<payloadB64>.<macB64> и отказ ДО JSON.parse на поддельном токене
    const codec = createCursorCodec({
      keys: { v1: '0123456789abcdef0123456789abcdef' },
      activeKey: 'v1',
      ttlSeconds: 300,
    })
    const encoded = await codec.encode({ resource: 'post' }, ['id_1'])
    expect(encoded.split('.')).toHaveLength(3)
    expect(await codec.decode(encoded, { resource: 'post' })).toEqual(['id_1'])

    const parseSpy = vi.spyOn(JSON, 'parse')
    parseSpy.mockClear()
    const forged = `${Buffer.from('v1').toString('base64url')}.${Buffer.from('{not-json').toString('base64url')}.${Buffer.from('bad-mac-bytes-000000000000000000').toString('base64url')}`
    await expect(codec.decode(forged, { resource: 'post' })).rejects.toThrow()
    expect(parseSpy).not.toHaveBeenCalled()
    parseSpy.mockRestore()

    // S12: backslash open-redirect блокируется localPath
    expect(localPath('/\\evil.example')).toBeNull()
    expect(localPath('//evil.example')).toBeNull()
    expect(localPath('/upload-demo?tab=1')).toBe('/upload-demo?tab=1')
  })
})
