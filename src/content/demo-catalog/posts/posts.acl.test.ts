import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, it } from 'vitest'
import { conservativeLimits, createDb, validateResourceAcl } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { posts } from './posts.js'

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

const owner = (id: string, permissions: readonly string[] = []) => ({
  principal: { id, roles: [...permissions] },
})

it('ACL модели demo.post валиден, а владелец записи может обновлять и удалять свою запись', async () => {
  validateResourceAcl(posts)

  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  assert.equal((await defineSchema({ resources: [posts] }).sync(driver)).status, 'ok')
  const db = createDb({ driver, limits: conservativeLimits, resources: [posts] })
  const postTable = db.resource(posts)

  const authorCtx = owner(crypto.randomUUID(), ['author'])
  const created = (await postTable.insert(authorCtx, { title: 'Запись автора' })) as unknown as { id: string }

  const exAuthorOwner = owner(authorCtx.principal.id, [])
  await postTable.update(exAuthorOwner, created.id, { title: 'Обновлено владельцем' })
  await postTable.delete(exAuthorOwner, created.id)
  assert.equal((await postTable.select(exAuthorOwner)).length, 0)
}, 60_000)
