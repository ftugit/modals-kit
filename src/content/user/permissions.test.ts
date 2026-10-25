// Страж каталога прав: право без текста нельзя показать на экране выдачи,
// право вне группы не попадёт в список, а расхождение `ADMIN_BUNDLE` с
// каталогом сделает кнопку «выдать всё» неполной.
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

test('у каждого права есть непустые название и описание', () => {
  const bare = all.filter((p) => !PERMISSIONS[p].title.trim() || !PERMISSIONS[p].description.trim())
  expect(bare).toEqual([])
})

test('ключ права — «область.действие» строчными', () => {
  const bad = all.filter((p) => !/^[a-z]+(\.[a-z]+)+$/.test(p))
  expect(bad).toEqual([])
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
