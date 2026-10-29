import { describe, expect, test } from 'vitest'
import { defineAcl, defineResource, f, forOwner, grants, type GrantActor } from '#lib/db/index.js'
import { createUseGrants } from './db-grants.svelte.js'

const idField = () =>
  f.uuid({
    read: () => true,
    createValue: () => crypto.randomUUID(),
    immutable: true,
    orderable: true,
    filters: ['eq'] as const,
  })

const modelA = defineResource({
  key: 't.hook.a',
  table: 'public.hook_a',
  primaryKey: 'id',
  fields: {
    id: idField(),
    owner_id: f.uuid({ read: () => true, create: () => true, required: true, immutable: true }),
    name: f.text({ read: () => true, create: () => true, update: () => true, nullable: true }),
  },
  acl: defineAcl({
    owner: { field: 'owner_id', can: ['read', 'edit'] },
    read: ['test', 'admin'],
    edit: ['a.edit', 'admin'],
  }),
  order: [['id', 'asc']],
})

const modelB = defineResource({
  key: 't.hook.b',
  table: 'public.hook_b',
  primaryKey: 'id',
  fields: {
    id: idField(),
    code: f.text({ read: () => true, create: () => true, required: true, immutable: true }),
    until: f.timestamp({ read: () => true, create: () => true, update: () => true, nullable: true }),
  },
  acl: defineAcl({
    insert: ['test2', 'admin'],
    update: ['test2'],
    edit: ['admin'],
  }),
  order: [['id', 'asc']],
})

describe('createUseGrants', () => {
  test('реактивно пересчитывает одиночную связку [a.select, b.insert], словарь, ownerId и чужой actor', () => {
    let sessionActor: GrantActor | null = { id: 'me', permissions: ['test'] }
    let targetOwner: string | null = 'other'
    const useGrants = createUseGrants(() => sessionActor)

    const gA = grants(modelA)
    const gB = grants(modelB)

    const combo = useGrants([gA.select, gB.insert])
    const dict = useGrants(
      {
        editA: gA.update,
        pickAndInsertB: [gA.select, gB.insert],
        mixed: [forOwner('me', gA.update), gB.insert],
      },
      { ownerId: () => targetOwner },
    )

    // У сессии есть только 'test' (без 'test2'):
    expect(combo.current).toBe(false)
    expect(dict).toEqual({
      editA: false,
      pickAndInsertB: false,
      mixed: false,
    })

    // Докидываем 'test2' в сессию -> связка [a.select, b.insert] мгновенно true:
    sessionActor = { id: 'me', permissions: ['test', 'test2'] }
    expect(combo.current).toBe(true)
    expect(dict).toEqual({
      editA: false,
      pickAndInsertB: true,
      mixed: true,
    })

    // Меняем targetOwner на 'me' -> editA становится true по 'owner':
    targetOwner = 'me'
    expect(dict.editA).toBe(true)

    // Разлогинились -> гость:
    sessionActor = null
    expect(combo.current).toBe(false)
    expect(dict.editA).toBe(false)

    // Явная проверка за другого пользователя (actor):
    const otherCheck = useGrants([gA.select, gB.insert], {
      actor: { id: 'colleague', permissions: ['admin'] },
    })
    expect(otherCheck.current).toBe(true)
  })
})
