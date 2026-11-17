/**
 * Связь `auth → profile` объявляет сам профильный субмодуль (через
 * `registerRelation`), а не `user/base`: иначе база зависела бы от
 * опционального модуля. Тест фиксирует оба свойства: базовая модель связи не
 * содержит, а после загрузки модуля include/сортировка по `profile` разрешаются.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { registerRelation, relationsOf } from '#core/lib/db/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import { profile } from '#modules/user/profile/model/profile.schema.js'

const relation = { resource: profile, localField: 'id', foreignField: 'auth_id' }

describe('связь профиля, зарегистрированная модулем', () => {
  it('база о профиле не знает, модуль объявляет связь', () => {
    assert.equal(auth.relations, undefined)
    const rel = relationsOf(auth)?.profile
    assert.ok(rel, 'auth.profile не зарегистрирована')
    assert.equal(rel.resource, profile)
    assert.equal(rel.localField, 'id')
    assert.equal(rel.foreignField, 'auth_id')
  })

  it('повторная регистрация той же связи не падает', () => {
    registerRelation(auth, 'profile', relation)
    assert.equal(relationsOf(auth)?.profile?.foreignField, 'auth_id')
  })

  it('конфликт с полем и с уже объявленной связью — ошибка', () => {
    assert.throws(() => registerRelation(auth, 'id', relation), /уже поле/)
    assert.throws(
      () =>
        registerRelation(auth, 'profile', {
          resource: profile,
          localField: 'id',
          foreignField: 'nickname',
        }),
      /уже объявлена/,
    )
  })
})
