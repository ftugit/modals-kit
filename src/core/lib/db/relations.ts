/**
 * Связи, зарегистрированные композицией.
 *
 * `defineResource` замораживает ресурс, поэтому опциональный модуль не может
 * дописать связь в базовую модель (`auth → profile`) напрямую. Шов нужен
 * ровно для этого: базовая модель не знает о субмодуле, а субмодуль при своей
 * загрузке объявляет связь на базовом ресурсе. Чтение связей идёт через
 * `relationsOf()` (объявленные в `defineResource` + зарегистрированные), поэтому
 * include/сортировка по связи работают одинаково.
 *
 * Регистрация идемпотентна по паре (ресурс, имя): повторная загрузка модуля не
 * должна падать, а конфликт с полем или уже объявленной связью — ошибка.
 */
import type { Relations, Resource } from './types.js'

const REGISTERED = new WeakMap<Resource, Relations>()

/**
 * Объявить связь на существующем ресурсе. Вызывается модулем, которому
 * принадлежит цель связи (например, `user/profile` объявляет `auth.profile`).
 */
export function registerRelation(
  resource: Resource,
  name: string,
  relation: Relations[string],
): void {
  if (!name || !relation || !relation.resource)
    throw new Error('registerRelation: нужны имя и объект связи')
  if (Object.prototype.hasOwnProperty.call(resource.fields, name))
    throw new Error(`registerRelation: «${name}» уже поле ${resource.key}`)
  const current = REGISTERED.get(resource)
  if (current && Object.prototype.hasOwnProperty.call(current, name)) {
    const prev = current[name]!
    if (
      prev.resource === relation.resource &&
      prev.localField === relation.localField &&
      prev.foreignField === relation.foreignField
    )
      return
    throw new Error(`registerRelation: связь «${name}» уже объявлена в ${resource.key}`)
  }
  if (resource.relations && Object.prototype.hasOwnProperty.call(resource.relations, name))
    throw new Error(`registerRelation: связь «${name}» уже объявлена в ${resource.key}`)
  if (!Object.prototype.hasOwnProperty.call(resource.fields, relation.localField))
    throw new Error(
      `registerRelation: ${resource.key}.${relation.localField} — нет такого поля`,
    )
  if (!Object.prototype.hasOwnProperty.call(relation.resource.fields, relation.foreignField))
    throw new Error(
      `registerRelation: ${relation.resource.key}.${relation.foreignField} — нет такого поля`,
    )
  REGISTERED.set(resource, { ...(current ?? {}), [name]: relation })
}

/** Все связи ресурса: объявленные в `defineResource` и добавленные модулями. */
export function relationsOf(resource: Resource): Relations | undefined {
  const declared = resource.relations
  const added = REGISTERED.get(resource)
  if (!declared && !added) return undefined
  return { ...(declared ?? {}), ...(added ?? {}) }
}
