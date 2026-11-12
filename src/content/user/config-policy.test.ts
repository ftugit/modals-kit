/**
 * Инвариант политики `user.config`: роль, которой разрешено писать, обязана
 * уметь читать. `lib/db/README.md` обещает это как свойство ядра, но проверки
 * не было — расхождение закрывается тестом, а не вычёркиванием обещания.
 *
 * Метаданные политики читаются по глобальному символу (`Symbol.for`), поэтому
 * публичный API `#lib/db` расширять не пришлось.
 */
import { describe, expect, test } from 'vitest'
import { config } from './schema.js'

const POLICY_META = Symbol.for('modals-kit.db.policyMeta')

type PolicyMeta = {
  kind: string
  roles?: readonly string[]
  clause?: readonly string[]
}

function rolesOf(fn: unknown): readonly string[] {
  const meta = (fn as Record<symbol, PolicyMeta | undefined> | null | undefined)?.[POLICY_META]
  if (!meta) return []
  if (meta.kind === 'roles' || meta.kind === 'ownerOrRoles') return meta.roles ?? []
  if (meta.kind === 'clause') return meta.clause ?? []
  return []
}

/** Круг чтения конфига: владелец строки плюс эти роли. */
const READERS = ['config.read', 'admin', 'server']
/** Круг записи: уже́ круга чтения, каждая роль отсюда обязана быть в `READERS`. */
const WRITERS = ['admin', 'server']

const select = rolesOf(config.policy?.select)
const update = rolesOf(config.policy?.update)
const remove = rolesOf(config.policy?.delete)
const insert = rolesOf(config.policy?.insert)

describe('user.config: инвариант «писать может только тот, кто читает»', () => {
  test('политика читается: метаданные у правил есть', () => {
    // Без этого зелёные проверки ниже ничего не значат: пустые множества
    // сравнивать не с чем.
    expect(select).toEqual(READERS)
    expect(update).toEqual(WRITERS)
    expect(remove).toEqual(WRITERS)
    expect(insert).toEqual(WRITERS)
  })

  test('каждая пишущая роль входит в чтение', () => {
    for (const [name, roles] of [
      ['update', update],
      ['delete', remove],
      ['insert', insert],
    ] as const) {
      for (const role of roles) {
        expect(select, `${name}: роль «${role}» пишет, но не читает`).toContain(role)
      }
    }
  })

  test('в чтении нет ролей вне объявленного круга', () => {
    // Негативный контроль на молчаливое расширение: новая роль в `select`
    // должна появиться здесь осознанно, а не заодно с правкой записи.
    expect([...select].sort()).toEqual([...READERS].sort())
    for (const role of select) expect(READERS).toContain(role)
  })
})
