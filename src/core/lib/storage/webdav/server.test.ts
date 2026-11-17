import { describe, expect, it } from 'vitest'
import {
  basicAuthGuard,
  createWebdavServer,
  memoryDavBackend,
  memoryDavLockStore,
  type DavBackend,
  type WebdavServer,
} from './server.js'

const BASE = 'https://dav.test/dav'

function harness(options: {
  readonly backend?: DavBackend
  readonly authorize?: (request: Request) => boolean
  readonly locks?: ReturnType<typeof memoryDavLockStore> | null
} = {}) {
  const backend = options.backend ?? memoryDavBackend()
  const server: WebdavServer = createWebdavServer({
    backend,
    basePath: '/dav',
    ...(options.authorize ? { authorize: options.authorize } : {}),
    ...(options.locks !== undefined ? { locks: options.locks } : {}),
  })
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    server.handle(new Request(`${BASE}${path}`, init))
  return { backend, server, call }
}

async function put(call: ReturnType<typeof harness>['call'], path: string, body: string) {
  return call(path, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body,
  })
}

describe('#core/lib/storage/webdav/server — протокол поверх DavBackend', () => {
  it('OPTIONS объявляет Class 2 и полный список методов', async () => {
    const { call } = harness()
    const res = await call('/', { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(res.headers.get('dav')).toBe('1, 2')
    const allow = res.headers.get('allow') ?? ''
    for (const method of ['PROPFIND', 'PROPPATCH', 'GET', 'PUT', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK']) {
      expect(allow).toContain(method)
    }
  })

  it('MKCOL + PUT + PROPFIND Depth:1 отдают дерево с корректными href', async () => {
    const { call } = harness()
    expect((await call('/docs', { method: 'MKCOL' })).status).toBe(201)
    expect((await put(call, '/docs/report.txt', 'hello')).status).toBe(201)

    const res = await call('/docs', { method: 'PROPFIND', headers: { depth: '1' } })
    expect(res.status).toBe(207)
    expect(res.headers.get('content-type')).toContain('application/xml')
    const xml = await res.text()
    expect(xml).toContain('<D:multistatus')
    expect(xml).toContain('<D:href>/dav/docs/</D:href>')
    expect(xml).toContain('<D:href>/dav/docs/report.txt</D:href>')
    expect(xml).toContain('<D:getcontentlength>5</D:getcontentlength>')
    expect(xml).toContain('<D:collection/>')
  })

  it('PROPFIND Depth:0 с явным prop отдаёт только запрошенное и 404 на чужое', async () => {
    const { call } = harness()
    await call('/a.txt', { method: 'PUT', body: 'abc' })
    const body =
      '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>' +
      '<D:getcontentlength/><D:displayname/><X:custom xmlns:X="urn:other:"/>' +
      '</D:prop></D:propfind>'
    const res = await call('/a.txt', {
      method: 'PROPFIND',
      headers: { depth: '0', 'content-type': 'application/xml' },
      body,
    })
    expect(res.status).toBe(207)
    const xml = await res.text()
    expect(xml).toContain('HTTP/1.1 200 OK')
    expect(xml).toContain('<D:getcontentlength>3</D:getcontentlength>')
    expect(xml).toContain('<D:displayname>a.txt</D:displayname>')
    expect(xml).toContain('HTTP/1.1 404 Not Found')
    expect(xml).toContain('<X:custom/>')
  })

  it('PROPFIND Depth:infinity отклоняется по умолчанию (403)', async () => {
    const { call } = harness()
    const res = await call('/', { method: 'PROPFIND', headers: { depth: 'infinity' } })
    expect(res.status).toBe(403)
  })

  it('GET/HEAD: сильный ETag для раздачи, Range 206 и If-None-Match 304', async () => {
    const { call } = harness()
    await put(call, '/f.txt', 'hello world')

    const head = await call('/f.txt', { method: 'HEAD' })
    expect(head.status).toBe(200)
    const etag = head.headers.get('etag') ?? ''
    expect(etag).toMatch(/^W\/"11-\d+"$/)
    expect(await head.text()).toBe('')

    const get = await call('/f.txt')
    expect(get.status).toBe(200)
    expect(get.headers.get('etag')).toBe(etag)
    expect(await get.text()).toBe('hello world')

    const partial = await call('/f.txt', { headers: { range: 'bytes=0-4' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 0-4/11')
    expect(await partial.text()).toBe('hello')

    const cached = await call('/f.txt', { headers: { 'if-none-match': etag } })
    expect(cached.status).toBe(304)
  })

  it('ETag из PROPFIND совпадает с ETag ответа GET', async () => {
    const { call } = harness()
    await put(call, '/same.txt', 'abc')
    const propfind = await call('/same.txt', { method: 'PROPFIND', headers: { depth: '0' } })
    const xml = await propfind.text()
    const propEtag = /<D:getetag>([^<]+)<\/D:getetag>/.exec(xml)?.[1]?.replace(/&quot;/g, '"')
    const get = await call('/same.txt')
    expect(propEtag).toBe(get.headers.get('etag'))
  })

  it('COPY/MOVE: Overwrite F даёт 412, перенос коллекции сохраняет детей', async () => {
    const { call } = harness()
    await call('/src', { method: 'MKCOL' })
    await put(call, '/src/a.txt', 'a')
    await call('/dst', { method: 'MKCOL' })

    const blocked = await call('/src/a.txt', {
      method: 'COPY',
      headers: { destination: `${BASE}/dst/a.txt`, overwrite: 'F' },
    })
    expect(blocked.status).toBe(201)

    const conflict = await call('/src/a.txt', {
      method: 'COPY',
      headers: { destination: `${BASE}/dst/a.txt`, overwrite: 'F' },
    })
    expect(conflict.status).toBe(412)

    const moved = await call('/src', {
      method: 'MOVE',
      headers: { destination: `${BASE}/moved` },
    })
    expect(moved.status).toBe(201)
    expect((await call('/src', { method: 'PROPFIND', headers: { depth: '0' } })).status).toBe(404)
    const listing = await (await call('/moved', { method: 'PROPFIND', headers: { depth: '1' } })).text()
    expect(listing).toContain('/dav/moved/a.txt')
  })

  it('MOVE в собственного потомка запрещён (409), MOVE корня — 403', async () => {
    const { call } = harness()
    await call('/tree', { method: 'MKCOL' })
    await call('/tree/inner', { method: 'MKCOL' })
    const nested = await call('/tree', {
      method: 'MOVE',
      headers: { destination: `${BASE}/tree/inner/tree` },
    })
    expect(nested.status).toBe(409)
    const root = await call('/', {
      method: 'MOVE',
      headers: { destination: `${BASE}/other` },
    })
    expect(root.status).toBe(403)
  })

  it('DELETE коллекции удаляет поддерево, повторный DELETE — 404', async () => {
    const { call } = harness()
    await call('/dir', { method: 'MKCOL' })
    await put(call, '/dir/x.txt', 'x')
    expect((await call('/dir', { method: 'DELETE' })).status).toBe(204)
    expect((await call('/dir/x.txt', { method: 'GET' })).status).toBe(404)
    expect((await call('/dir', { method: 'DELETE' })).status).toBe(404)
  })

  it('LOCK: без токена запись даёт 423, с If — 204, UNLOCK освобождает', async () => {
    const { call } = harness()
    await put(call, '/locked.txt', 'v1')
    const lockBody =
      '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:">' +
      '<D:lockscope><D:exclusive/></D:lockscope>' +
      '<D:locktype><D:write/></D:locktype>' +
      '<D:owner>test</D:owner></D:lockinfo>'
    const locked = await call('/locked.txt', {
      method: 'LOCK',
      headers: { 'content-type': 'application/xml', timeout: 'Second-600' },
      body: lockBody,
    })
    expect(locked.status).toBe(201)
    const token = (locked.headers.get('lock-token') ?? '').replace(/[<>]/g, '')
    expect(token).toMatch(/^urn:uuid:/)
    expect(await locked.text()).toContain('<D:lockdiscovery>')

    expect((await put(call, '/locked.txt', 'v2')).status).toBe(423)
    const withToken = await call('/locked.txt', {
      method: 'PUT',
      headers: { if: `(<${token}>)` },
      body: 'v2',
    })
    expect(withToken.status).toBe(204)

    const secondLock = await call('/locked.txt', {
      method: 'LOCK',
      headers: { 'content-type': 'application/xml' },
      body: lockBody,
    })
    expect(secondLock.status).toBe(423)

    const unlocked = await call('/locked.txt', {
      method: 'UNLOCK',
      headers: { 'lock-token': `<${token}>` },
    })
    expect(unlocked.status).toBe(204)
    expect((await put(call, '/locked.txt', 'v3')).status).toBe(204)
  })

  it('без стора блокировок сервер объявляет только Class 1 и отвечает 501', async () => {
    const { call } = harness({ locks: null })
    const options = await call('/', { method: 'OPTIONS' })
    expect(options.headers.get('dav')).toBe('1')
    const lock = await call('/', { method: 'LOCK', body: '<D:lockinfo xmlns:D="DAV:"/>' })
    expect(lock.status).toBe(501)
  })

  it('Basic-пароль: 401 без заголовка, 200 с верными данными', async () => {
    const { call } = harness({
      authorize: basicAuthGuard({ username: 'dav-user', password: 'app-password' }),
    })
    const denied = await call('/', { method: 'OPTIONS' })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toContain('Basic realm=')

    const allowed = await call('/', {
      method: 'OPTIONS',
      headers: {
        authorization: `Basic ${btoa('dav-user:app-password')}`,
      },
    })
    expect(allowed.status).toBe(200)
  })

  it('кодированный обход корня отклоняется (400), кириллица в имени работает', async () => {
    const { call } = harness()
    expect((await call('/%2e%2e/secret')).status).toBe(400)
    await call('/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0', { method: 'MKCOL' })
    const listing = await (await call('/', { method: 'PROPFIND', headers: { depth: '1' } })).text()
    expect(listing).toContain('/dav/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0/')
  })

  it('PUT без родительской коллекции — 409, PUT поверх коллекции — 405', async () => {
    const { call } = harness()
    expect((await put(call, '/missing/file.txt', 'x')).status).toBe(409)
    await call('/folder', { method: 'MKCOL' })
    expect((await put(call, '/folder', 'x')).status).toBe(405)
  })
})
