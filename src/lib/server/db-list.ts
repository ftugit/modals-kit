/**
 * Серверная половина списка демо: один конвейер для SSR-снапшота пагинатора и
 * для HTTP-эндпоинта, и ОДНА точка, где выбирается «страница по номеру» или
 * «продолжение по токену».
 *
 * Оба пути идут через слой (`parseListInput` → `select`/`count` либо `cursor`) и
 * через `toKitError` — разбор адреса и отказ на неизвестный ключ обязаны быть
 * одинаковыми, иначе «перезагрузка страницы даёт другой список» вернётся.
 *
 * Два адреса — один источник данных:
 *   `?page=N`        → offset (`select` + `count`): totals известны, номера страниц есть;
 *   `?after=<токен>` → keyset (`cursor`, `LIMIT n+1`): продолжение без счёта, токен
 *                      подписан сервером и живёт в адресе — поэтому ссылка ведёт туда
 *                      же и без JavaScript. `totalItems` тут сознательно нет: счётчик
 *                      был бы ВТОРЫМ запросом на каждый шаг, а номеров страницы в
 *                      потоке всё равно нет.
 */
import { parseListInput, toKitError } from '$lib/db/sveltekit'
import type { DataContext } from '$lib/db'
import type { PageResponse } from '$lib/paginate'
import { createPaginatorStore, initServerPaginator } from '$lib/paginate'
import {
  DB_LIST_PAGE_SIZE,
  ensureDbListPaginator,
  setDbPostsServerTransport,
  type DbPost,
  type DbPostsQuery,
} from '$lib/ui/demo/db-list/definition'
import { DEMO_PRINCIPAL, getRuntime, posts } from './db'

/**
 * Порядок keyset-выборки обязан быть ПОЛНЫМ. Без уникального хвоста строки с
 * одинаковым значением сортируемого поля на границе страницы либо дублируются,
 * либо пропадают: `keyset` сравнивает кортеж значений, а не «позицию». `id` —
 * первичный ключ, поэтому он дописан к ЛЮБОМУ порядку в курсорном режиме; токен
 * привязан к порядку своим scope (`resource.ts:166`), так что «тихая» подмена
 * порядка чужим токеном отвергается самим слоем.
 */
function totalOrder(raw: string | undefined): string {
  let pairs: [string, string][]
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed) || !parsed.every((p) => Array.isArray(p) && p.length === 2)) return raw ?? ''
    pairs = parsed as [string, string][]
  } catch {
    // Битый JSON — не наша епархия: пусть `parseListInput` откажет своим
    // `validation`, а не мы синтаксической ошибкой на 500.
    return raw ?? ''
  }
  if (pairs.length === 0) pairs = [['created_at', 'desc']]
  if (pairs.some(([field]) => field === 'id')) return JSON.stringify(pairs)
  // Направление хвоста — восходящее: индекс `demo_post_page` построен как
  // `(created_at DESC NULLS LAST, id ASC NULLS LAST)`, то есть полный порядок
  // получается ровно тем же движком, что и выборка.
  return JSON.stringify([...pairs, ['id', 'asc']])
}

/**
 * Отказы, которые демо обязано объяснять своими словами. Коды приходят от слоя
 * (`toKitError` → `body.code`); без этой строки пользователь увидел бы
 * «Operation not supported by this transport» — верно, но бесполезно.
 */
const EXPLAIN: Record<string, string> = {
  unsupported:
    'Курсор выключен: на сервере не задан DB_CURSOR_SECRET — подписывать токены нечем. Постраничный режим и остальные операции работают как раньше.',
  cursor:
    'Токен страницы недействителен или устарел (время жизни — DB_CURSOR_TTL_SECONDS, по умолчанию 30 минут). Начните с первой страницы.',
}

async function queryPage(query: DbPostsQuery, ctx: DataContext): Promise<PageResponse<DbPost>> {
  const { db } = await getRuntime()
  const api = db.resource(posts)
  // Ключи адреса переводятся в те, что разбирает слой: пагинатор говорит
  // «page/size», слой говорит «page/limit». Один перевод — на оба пути.
  const after = typeof query.after === 'string' && query.after !== '' ? query.after : null
  const params = new URLSearchParams({ limit: String(query.pageSize) })
  if (after !== null) params.set('after', after)
  else params.set('page', String(query.page))
  if (query.filter) params.set('filter', query.filter)
  const order = after !== null ? totalOrder(query.order) : query.order
  if (order) params.set('order', order)
  // `page` и `after` взаимоисключающи на уровне слоя, и режим выбирается ЗДЕСЬ
  // одним условием: у источника нет второй ветки, которая решала бы иначе.
  const input =
    after !== null ? parseListInput(params, { cursor: true }) : parseListInput(params)
  if (after !== null) {
    const page = await api.cursor(ctx, input)
    return {
      items: page.items as DbPost[],
      hasNext: page.nextCursor !== null,
      // Указатель следующего шага едет в extra состояния (см. `mergeResponseExtra`
      // в ядре пагинатора): только так он попадает и в адрес, и в ссылку, которую
      // рисует SSR. Пустое значение = «дальше некуда», ядро снимает ключ.
      extra: { after: page.nextCursor ?? '' },
    }
  }
  // total — по ТОМУ ЖЕ фильтру, что и страница: иначе «всего записей» и
  // «подходит под фильтр» — два разных числа под одним заголовком, а
  // пагинатор по такому total построит несуществующие страницы.
  const filterOnly = { filter: input.filter }
  const [items, totalItems] = await Promise.all([api.select(ctx, input), api.count(ctx, filterOnly)])
  const size = input.limit ?? DB_LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalItems / size))
  return {
    items: items as DbPost[],
    totalItems,
    totalPages,
    hasNext: (input.page ?? 1) < totalPages,
  }
}

/**
 * Транспорт для SSR-снапшота: вызов слоя напрямую, без HTTP-запроса приложения
 * к самому себе (иначе первая отрисовка платит соединением и таймаутами).
 *
 * Чтение в демо открыто политикой (`policy.publicRows`), поэтому снапшот
 * строится тем же принципом, что ставит хук, — `DEMO_PRINCIPAL` один на
 * хук, снапшот и эндпоинт.
 */
setDbPostsServerTransport((query) =>
  queryPage(query, Object.freeze({ principal: DEMO_PRINCIPAL, signal: query.signal })),
)

/** Снапшот пагинатора для `+page.server.ts`: страница из адреса запроса. */
export async function loadDbListSnapshot(url: string) {
  const name = ensureDbListPaginator()
  const store = createPaginatorStore()
  const snapshot = await initServerPaginator<DbPost>(store, name, { url })
  return { name, snapshot }
}

/** Ответ эндпоинта: страница или готовый к показу отказ (текст + код). */
export async function fetchDbPostsPage(
  query: DbPostsQuery,
  ctx: DataContext,
): Promise<PageResponse<DbPost> | { error: string; code: string; status: number }> {
  try {
    return await queryPage(query, ctx)
  } catch (e) {
    const kit = toKitError(e, import.meta.env.DEV)
    const code = String(kit.body.code ?? 'database')
    return { error: EXPLAIN[code] ?? String(kit.body.message ?? 'база отклонила запрос'), code, status: kit.status }
  }
}
