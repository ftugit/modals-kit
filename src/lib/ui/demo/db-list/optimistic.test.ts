/**
 * Оптимистичная строка — проверка состояний без браузера и без базы.
 *
 * Что здесь дорого: идемпотентность `begin` (повтор той же строки обязан вернуть
 * ТУ ЖЕ карточку, иначе «повторить» плодит копию), замена НА МЕСТЕ (иначе список
 * подпрыгивает), режим отказа (данные не должны исчезать молча) и исчезновение
 * карточки, когда её строка приехала из источника. Порядок сортировки — отдельный
 * тест: «в конец DOM» и «за последним id» это разные утверждения.
 */
import { describe, expect, it } from 'vitest'
import {
  createOptimistic,
  isAbsorbed,
  pendingPlacement,
  type OptimisticCard,
} from './optimistic.svelte'
import type { DbPost } from './definition'

const row = (over: Partial<DbPost> = {}): DbPost => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'запись',
  created_at: '2026-10-10T12:00:00.000Z',
  ...over,
})

describe('оптимистичная карточка демо-БД', () => {
  it('повтор ЭТОЙ ЖЕ отправки — та же карточка; та же строка заново — новая', () => {
    const store = createOptimistic()
    const first = store.begin('один и тот же заголовок')
    expect(store.list()).toHaveLength(1)
    expect(store.begin('один и тот же заголовок', first)).toBe(first)
    expect(store.list()).toHaveLength(1)
    expect(store.inflight()).toBe(1)
    // Уникальности по title в схеме нет: два запроса без связи друг с другом —
    // две карточки, и обе честные.
    store.begin('один и тот же заголовок')
    expect(store.list()).toHaveLength(2)
  })

  it('успех заменяет карточку серверной строкой на её месте, id становится настоящим', () => {
    const store = createOptimistic()
    const tmp = store.begin('свежая')
    const real = row({ id: '22222222-2222-4222-8222-222222222222', title: 'свежая' })
    const before = store.list()[0]
    store.confirm(tmp, real)
    const after = store.list()[0]
    expect(store.list()).toHaveLength(1)
    expect(after.tmpId).toBe(before.tmpId) // то же место в массиве — без скачка
    expect(after.state).toBe('settled')
    expect(after.row).toEqual(real)
    expect(store.inflight()).toBe(0)
  })

  it('отказ по умолчанию оставляет карточку с ошибкой; «убрать» удаляет её', () => {
    const store = createOptimistic()
    const tmp = store.begin('не пройдёт')
    store.fail(tmp, 'такое название уже занято')
    expect(store.list()[0].state).toBe('failed')
    expect(store.list()[0].error).toBe('такое название уже занято')

    store.setFailureMode('remove')
    const second = store.begin('вторая')
    store.fail(second, 'такое название уже занято')
    expect(store.list().map((c) => c.title)).toEqual(['не пройдёт'])
    expect(store.list().some((c) => c.tmpId === second)).toBe(false)
  })

  it('«settled» не переиспользуется: та же отправка после успеха — новая карточка', () => {
    const store = createOptimistic()
    const tmp = store.begin('одна')
    store.confirm(tmp, row({ title: 'одна' }))
    const again = store.begin('одна', tmp)
    expect(again).not.toBe(tmp)
    expect(store.list()[1].state).toBe('pending')
  })

  it('карточка всасывается по id и ТОЛЬКО по id', () => {
    const store = createOptimistic()
    const tmp = store.begin('приехавшая')
    const pending: OptimisticCard = { ...store.list()[0] }
    const real = row({ id: '33333333-3333-4333-8333-333333333333', title: 'приехавшая' })
    // Пока серверного id нет, «похожая» строка карточку не отменяет: заголовки
    // не уникальны, и иначе опрос съедал бы только что начатую отправку.
    expect(isAbsorbed(pending, [real])).toBe(false)
    expect(isAbsorbed({ ...pending, state: 'settled', row: real }, [real])).toBe(true)
    expect(isAbsorbed({ ...pending, state: 'settled', row: real }, [row({ title: 'приехавшая' })])).toBe(false)
    expect(store.list()[0].tmpId).toBe(tmp) // store сам ничего не удаляет — решает окно
  })

  it('место карточки определяется порядком, а не «концом списка»', () => {
    // created_at DESC (он же порядок по умолчанию): новые — в начале.
    expect(pendingPlacement('default')).toBe('head')
    expect(pendingPlacement(undefined)).toBe('head')
    expect(pendingPlacement('[["created_at","desc"]]')).toBe('head')
    // created_at ASC: новая строка — за последней.
    expect(pendingPlacement('[["created_at","asc"]]')).toBe('tail')
    // Чужой ключ порядка и мусор в адресе не должны уносить карточку в хвост.
    expect(pendingPlacement('[["title","asc"]]')).toBe('head')
    expect(pendingPlacement('{не json')).toBe('head')
  })

  it('retry переводит карточку в полёт и зовёт форму ровно один раз', () => {
    let calls = 0
    // `resubmit` форма регистрирует сама (`setResubmit`) — здесь проверяется, что
    // карточка честно отдаёт отправку наружу и не пытается повторить её сама.
    const store = createOptimistic()
    store.setResubmit(() => {
      calls += 1
    })
    const tmp = store.begin('упавшая')
    store.fail(tmp, 'сеть')
    expect(store.list()[0].state).toBe('failed')
    store.retry(tmp)
    expect(calls).toBe(1)
    expect(store.list()[0].state).toBe('pending')
    expect(store.list()[0].error).toBeUndefined()
  })
})
