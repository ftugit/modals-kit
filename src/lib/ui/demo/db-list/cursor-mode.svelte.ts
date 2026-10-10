/**
 * Режим курсора источника БД — ОДНА производная на оба демо (`/db-demo` и пункт
 * «БД» в демо-пагинаторе), потому что режим принадлежит источнику, а не странице.
 *
 * Две вещи, которые обязаны совпадать на обеих страницах:
 *   • значение режима — из состояния, а на сервере из ТОГО ЖЕ снапшота, из которого
 *     пришли строки (иначе `?page.cur=1` дал бы расхождение SSR/клиента — ровно то,
 *     о чём предупреждает `snapshotSafeError`);
 *   • снятие режима снимает и указатель следующего шага. `?page.after` — значение,
 *     которое выдал сервер; само по себе оно не «просрочивается», когда тумблер
 *     выключили, и осело бы в адресе и в ссылках навигации. Источник обязан его
 *     игнорировать (см. `fetchDbPosts`), а адрес обязан быть честным — поэтому у
 *     ключа стоит `''`, что для пагинатора значит «ключа нет».
 */
import { usePaginatorActions, usePaginatorState } from '$lib/paginate/svelte'
import type { PaginatorState } from '$lib/paginate'
import { DB_LIST_POINTER_KEY, isCursorOn, type DbPost } from './definition'

/**
 * Доступ к признаку режима; вызывается там, где есть имя пагинатора. Снимок
 * лоадера передаётся доступором, а не значением: проп — внешняя величина, и
 * захватить её «один раз на всё время» значило бы разойтись с хостом, который
 * читает её реактивно.
 */
export function useCursorMode(
  name: string,
  snapshot?: () => PaginatorState<DbPost> | null | undefined,
): () => boolean {
  const state = usePaginatorState<DbPost>(name)
  const actions = usePaginatorActions(name)
  const cursor = $derived(isCursorOn(state().extra) || isCursorOn(snapshot?.()?.extra))
  $effect(() => {
    if (cursor) return
    const stale = state().extra?.[DB_LIST_POINTER_KEY]
    if (typeof stale === 'string' && stale !== '') actions.setExtra({ [DB_LIST_POINTER_KEY]: '' })
  })
  return () => cursor
}
