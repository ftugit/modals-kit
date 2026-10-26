// Страж каталога прав: право без текста нельзя показать на экране выдачи,
// право вне группы не попадёт в список, расхождение `ADMIN_BUNDLE` с
// каталогом сделает кнопку «выдать всё» неполной, а опечатка в правиле
// модели (`profile.reed`) оставит правило мёртвым — оно просто никогда не
// совпадёт ни с одной выданной строкой.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  ADMIN_BUNDLE,
  ADMIN_INFO,
  ADMIN_ROLE,
  PERMISSION_GROUPS,
  PERMISSIONS,
  describeGrant,
  isPermission,
  type Permission,
} from './permissions.js'

const all = Object.keys(PERMISSIONS) as Permission[]

/** Строки прав, записанные в правилах модели профиля. */
function grantedInSchema(): string[] {
  const source = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
  return [...source.matchAll(/'(account|profile|session)\.[a-z]+'/g)].map((m) => m[0].slice(1, -1))
}

test('у каждого права есть непустые название и описание', () => {
  const bare = all.filter((p) => !PERMISSIONS[p].title.trim() || !PERMISSIONS[p].description.trim())
  expect(bare).toEqual([])
})

test('действий ровно три, и в каталоге только два выдаваемых', () => {
  const verbs = all.map((p) => p.split('.')[1])
  expect(new Set(verbs)).toEqual(new Set(['read', 'edit']))
  // `*.create` не выдаётся: строки заводит сервер (`policy.roles(['server'])`)
  expect(all.filter((p) => p.endsWith('.create'))).toEqual([])
})

test('ключ права — «область.действие» строчными', () => {
  expect(all.filter((p) => !/^[a-z]+(\.[a-z]+)+$/.test(p))).toEqual([])
})

test('каждое право ровно в одной группе', () => {
  const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions)
  expect(listed.filter((p) => !all.includes(p))).toEqual([])
  expect([...listed].sort()).toEqual([...all].sort())
  expect(new Set(listed).size).toBe(listed.length)
})

test('«выдать всё» — это весь каталог', () => {
  expect([...ADMIN_BUNDLE].sort()).toEqual([...all].sort())
})

test('администратор — отдельное имя, а не право каталога', () => {
  expect(isPermission(ADMIN_ROLE)).toBe(false)
  expect(describeGrant(ADMIN_ROLE)).toBe(ADMIN_INFO)
  expect(isPermission('profile.read')).toBe(true)
  expect(describeGrant('profile.read')).toBe(PERMISSIONS['profile.read'])
  expect(isPermission('profile.nope')).toBe(false)
  expect(describeGrant('profile.nope')).toBeUndefined()
})

test('правила модели ссылаются только на известные права', () => {
  const used = grantedInSchema()
  expect(used.length).toBeGreaterThan(0)
  expect(used.filter((p) => !isPermission(p)).sort()).toEqual([])
})
