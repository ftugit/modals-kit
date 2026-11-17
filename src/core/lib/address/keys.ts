/**
 * Бронь ключей строки запроса и алгебра адреса поверх одного писателя.
 *
 * Зачем. Писатель адреса (`core.ts`) решает, КАК запись попадает в историю
 * (очередь, намерение, обход), но не знает, ЧЕЙ ключ и ЧТО можно: «каждый
 * правит только свои ключи» было честным словом, а алгебра «собери следующий
 * адрес, не потеряв чужое» у каждого владельца была своя, руками. Здесь одна
 * точка доступа к GET-ключам:
 *
 *  • **Бронь.** Потребитель объявляет свои ключи при создании (`claimQuery`):
 *    точное имя (`step`) или семейство с точкой (`page.*`). Повторная бронь
 *    своего — не ошибка; чужое имя, чужое семейство и ключ под чужим
 *    семейством — исключение при старте, до любого адреса.
 *  • **Права.** Писать (`nextSearch`) и сбрасывать (`drop`) можно только
 *    забронированное себе; чужое и небронированное — исключение до отправки.
 *    Читать (`readQuery`) можно всё.
 *  • **Чужое не теряется структурно.** Следующий адрес строится от видимого:
 *    чужие ключи остаются в значении и в порядке. Права здесь не спасают от
 *    потери — алгебра: она чужое не выбрасывает даже без всякой брони.
 *  • **Проверка на коммите.** Запись с владельцем (`writeAddress` с
 *    `owner`) при том же пути сверяет, какие ключи реально изменились:
 *    изменил чужой — запись отклоняется исключением, мимо брони не пройти.
 */

/** Бронь: точное имя (`step`) или семейство с хвостом (`page.*`). */
export type QueryClaim = string

type Held = { owner: string; pattern: boolean }

const registry = new Map<string, Held>()

/** Сброс реестра — для тестов и горячего перезапуска dev-сервера. */
export function resetQueryClaims(): void {
  registry.clear()
}

/** Владелец имени: точная бронь или ближайшее семейство выше по точкам. */
function ownerOf(name: string): Held | undefined {
  const exact = registry.get(name)
  if (exact) return exact
  let dot = name.lastIndexOf('.')
  while (dot > 0) {
    const held = registry.get(name.slice(0, dot))
    if (held?.pattern) return held
    dot = name.lastIndexOf('.', dot - 1)
  }
  return undefined
}

/** Забронировать ключи за владельцем. Повторная бронь своего — не ошибка. */
export function claimQuery(owner: string, ...keys: readonly QueryClaim[]): void {
  for (const raw of keys) {
    const pattern = raw.endsWith('.*')
    const key = pattern ? raw.slice(0, -2) : raw
    const held = registry.get(key)
    if (held && held.owner !== owner)
      throw new Error(`ключ «${key}» уже забронирован «${held.owner}» (претендент: «${owner}»)`)
    // чужое семейство выше по точкам уже накрывает новый ключ
    let dot = key.lastIndexOf('.')
    while (dot > 0) {
      const up = registry.get(key.slice(0, dot))
      if (up?.pattern && up.owner !== owner)
        throw new Error(
          `ключ «${key}» покрыт семейством «${key.slice(0, dot)}.*» («${up.owner}»), претендент: «${owner}»`,
        )
      dot = key.lastIndexOf('.', dot - 1)
    }
    // новое семейство накрывает чужие точные ключи ниже
    if (pattern) {
      for (const [k, v] of registry) {
        if (v.owner !== owner && k.startsWith(`${key}.`))
          throw new Error(`семейство «${raw}» накрывает «${k}» владельца «${v.owner}», претендент: «${owner}»`)
      }
    }
    // повтор своей брони не снимает семейный флаг
    registry.set(key, { owner, pattern: (held?.pattern ?? false) || pattern })
  }
}

function assertOwn(owner: string, name: string, what: string): void {
  const held = ownerOf(name)
  if (!held) throw new Error(`${what}: ключ «${name}» никем не забронирован`)
  if (held.owner !== owner)
    throw new Error(`${what}: ключ «${name}» забронирован «${held.owner}», у «${owner}» прав нет`)
}

const stripsFamily = (raw: string): { name: string; pattern: boolean } => ({
  name: raw.endsWith('.*') ? raw.slice(0, -2) : raw,
  pattern: raw.endsWith('.*'),
})

/** Значение своего ключа в патче; `null`/`undefined`/`''` — убрать. */
export type QueryPatchValue = string | number | boolean | null | undefined | readonly (string | number)[]

/**
 * Следующий search от видимого: свои ключи из патча, чужие не тронуты ни в
 * значении, ни в порядке. Ключ патча `x.*` — явная замена семейства: убрать
 * `x` и `x.…`, записать `x` (цепочка модалок — одно значение через запятую);
 * обычный `x` меняет только `x`, соседей не трогает (`page` рядом с `page.size`).
 * `drop` — сброс без значения (своё семейство вида `page.filters.*`).
 * Возвращает только search (`'?a=1'` или `''`); путь и якорь остаются странице.
 */
export function nextSearch(
  owner: string,
  from: string | URLSearchParams,
  patch: Record<string, QueryPatchValue>,
  opts: { drop?: readonly string[] } = {},
): string {
  const params = new URLSearchParams(from)
  for (const raw of opts.drop ?? []) {
    const { name, pattern } = stripsFamily(raw)
    assertOwn(owner, name, 'сброс')
    for (const existing of [...params.keys()]) {
      if (existing === name || (pattern && existing.startsWith(`${name}.`))) params.delete(existing)
    }
  }
  for (const [raw, value] of Object.entries(patch)) {
    const { name, pattern } = stripsFamily(raw)
    assertOwn(owner, name, 'запись')
    for (const existing of [...params.keys()]) {
      if (existing === name || (pattern && existing.startsWith(`${name}.`))) params.delete(existing)
    }
    if (value === null || value === undefined || value === '') continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Чтение: любого ключа, права не нужны. Повторяющийся — массив. */
export function readQuery(
  from: string | URLSearchParams,
  name: string,
): string | readonly string[] | undefined {
  const all = new URLSearchParams(from).getAll(name)
  if (all.length === 0) return undefined
  return all.length === 1 ? all[0] : all
}

/**
 * Перенос no-JS-формой: все ключи, кроме перечисленных в `drop` (свой сброс:
 * точное имя или семейство `x.*`), пустые значения не переносятся.
 * Повторяет договор `carryFields` пагинатора: свои extra-ключи форма несёт
 * сама, в `drop` — только то, что правит отправка (указатель страницы).
 */
export function carryQuery(
  owner: string,
  from: string | URLSearchParams,
  drop: readonly string[] = [],
): { name: string; value: string }[] {
  const params = new URLSearchParams(from)
  const hidden = new Set<string>()
  for (const raw of drop) {
    const { name, pattern } = stripsFamily(raw)
    assertOwn(owner, name, 'сброс')
    for (const existing of [...params.keys()]) {
      if (existing === name || (pattern && existing.startsWith(`${name}.`))) hidden.add(existing)
    }
  }
  const out: { name: string; value: string }[] = []
  for (const [name, value] of [...params]) {
    if (!hidden.has(name) && value !== '') out.push({ name, value })
  }
  return out
}

/**
 * Права правки: ключи, изменившиеся между `before` и `after`, обязаны быть
 * своими. Вызывается писателем на коммите при том же пути (смена пути —
 * переход на другую страницу, у той своя бронь). Значения не смотрит — только
 * состав ключей (добавился, исчез, сменился — всё равно запись).
 */
export function checkKeys(
  owner: string,
  before: string | URLSearchParams,
  after: string | URLSearchParams,
): void {
  const was = new URLSearchParams(before)
  const now = new URLSearchParams(after)
  const changed = new Set<string>()
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = was.getAll(key).join('\u0000')
    const b = now.getAll(key).join('\u0000')
    if (a !== b) changed.add(key)
  }
  for (const key of changed) assertOwn(owner, key, 'правка адреса')
}
