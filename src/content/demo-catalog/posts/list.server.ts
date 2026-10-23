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
import { ApiError } from '#hooks/api-error.js'
import { parseListInput, toKitError } from '#lib/db/sveltekit/index.js'
import type { DataContext } from '#lib/db/index.js'
import type { PageResponse } from '#lib/paginate/index.js'
import { createPaginatorStore, initServerPaginator } from '#lib/paginate/index.js'
import {
  DB_CHANGES_SLACK_MS,
  DB_FRESH_LIMIT,
  DB_LIST_PAGE_SIZE,
  ensureDbListPaginator,
  setDbPostsServerTransport,
  type DbPost,
  type DbPostsChanged,
  type DbPostsFresh,
  type DbPostsQuery,
} from '#content/demo-catalog/posts/source.js'
import { DEMO_PRINCIPAL, db, posts } from '#server/db.server.js'

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
    'Токен страницы недействителен или устарел. Указатель продлевается сам при каждом заходе, но не живёт дольше DB_CURSOR_MAX_AGE_SECONDS (по умолчанию 7 дней). Начните с первой страницы.',
  schema_pending:
    'Модели разошлись со схемой базы — нужен перенос. Что изменится и кнопка «Выполнить» — на странице /db-demo.',
  validation: 'Параметры списка не прошли проверку. Начните с первой страницы или сбросьте фильтры.',
  forbidden: 'Нет доступа к этому списку.',
  unavailable: 'База сейчас недоступна. Обновите страницу чуть позже.',
  database: 'База не смогла выполнить запрос. Попробуйте ещё раз.',
}

/** Срез: `created_at` и `id` одной строкой — формат закладки (`<ISO>|<id>`). */
const asofOf = (row: DbPost | undefined): string | null =>
  row ? `${isoOf(row.created_at) ?? ''}|${row.id}` : null

async function queryPage(query: DbPostsQuery, ctx: DataContext): Promise<PageResponse<DbPost>> {
  const api = db.resource(posts)
  // Ключи адреса переводятся в те, что разбирает слой: пагинатор говорит
  // «page/size», слой говорит «page/limit». Один перевод — на оба пути.
  const after = typeof query.after === 'string' && query.after !== '' ? query.after : null
  // Keyset включается ЛИБО токеном, ЛИБО режимом: на первом шаге курсорного
  // режима токена ещё нет, но страница обязана быть выдана тем же способом —
  // иначе она не получит указателя, и «дальше» не появится никогда.
  const keyset = after !== null || query.cursor === true
  const params = new URLSearchParams({ limit: String(query.pageSize) })
  if (after !== null) params.set('after', after)
  else if (!keyset) params.set('page', String(query.page))
  if (query.filter) params.set('filter', query.filter)
  const order = keyset ? totalOrder(query.order) : query.order
  if (order) params.set('order', order)
  // `page` и `after` взаимоисключающи на уровне слоя, и режим выбирается ЗДЕСЬ
  // одним условием: у источника нет второй ветки, которая решала бы иначе.
  const input = keyset ? parseListInput(params, { cursor: true }) : parseListInput(params)
  if (keyset) {
    const page = await api.cursor(ctx, input)
    // Ключ начала порции: переподписанный сервером (`beginCursor`), а если
    // порция с головы — пусто. Пустой в ответ НЕ идёт (см. ниже).
    const beg = page.beginCursor ?? ''
    return {
      items: page.items as DbPost[],
      hasNext: page.nextCursor !== null,
      // Указатель следующего шага едет в extra состояния (см. `mergeResponseExtra`
      // в ядре пагинатора): только так он попадает и в адрес, и в ссылку, которую
      // рисует SSR. Пустое значение = «дальше некуда», ядро снимает ключ.
      //
      // `beg` — ключ, с которого выдана ЭТА порция (пусто — с начала выдачи).
      // Адрес хранит именно его (§4.2 плана live-update: «ключ видимой порции»),
      // и по нему же страница восстанавливается после перезагрузки; `after`
      // остаётся указателем следующей догрузки. Два разных вопроса — два ключа.
      // `beg` — только когда он есть: пустой ключ в ответе СНИМАЕТ значение в
      // состоянии (правило ядра «'' = ключа нет»), а вместе с ним и `page.after`
      // в адресе. После перезагрузки так терялся бы ключ видимой порции: первая
      // же страница, прочитанная с головы, приносила бы `beg: ''`.
      extra: {
        after: page.nextCursor ?? '',
        ...(beg ? { beg } : {}),
      },
    }
  }
  // total — по ТОМУ ЖЕ фильтру, что и страница: иначе «всего записей» и
  // «подходит под фильтр» — два разных числа под одним заголовком, а
  // пагинатор по такому total построит несуществующие страницы.
  // Срез «на момент»: номер страницы — смещение, и любая новая строка сдвигает
  // всю выдачу. Ключ приходит из адреса; на первой загрузке его нет — тогда
  // срезом становится самая свежая строка выдачи, и сервер отдаёт его в `extra`
  // (так он попадает и в адрес, и в ссылки страниц). Фильтр берётся целиком:
  // выдача сужается тем же условием, что и счётчик.
  let asof = query.asof ?? null
  if (!keyset && !asof) {
    const newest = (await api.select(ctx, {
      filter: input.filter,
      order: [['created_at', 'desc'], ['id', 'desc']],
      limit: 1,
      fields: ['id', 'created_at'],
    })) as DbPost[]
    asof = asofOf(newest[0])
  }
  const sliced = asof ? { ...input, asof } : input
  const filterOnly = { filter: input.filter, ...(asof ? { asof } : {}) }
  const [items, totalItems] = await Promise.all([api.select(ctx, sliced), api.count(ctx, filterOnly)])
  const size = input.limit ?? DB_LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalItems / size))
  return {
    items: items as DbPost[],
    totalItems,
    totalPages,
    hasNext: (input.page ?? 1) < totalPages,
    // Срез едет ответом, а не рождается на клиенте: без JS его нечем подписать,
    // и ссылки страниц из SSR обязаны нести тот же ключ.
    ...(asof ? { extra: { asof } } : {}),
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
setDbPostsServerTransport(async (query) => {
  try {
    return await queryPage(query, Object.freeze({ principal: DEMO_PRINCIPAL, signal: query.signal }))
  } catch (e) {
    // SSR-путь объясняет отказ теми же словами, что и эндпоинт: иначе снапшот
    // уносил в разметку текст слоя по умолчанию («Invalid or expired cursor»).
    // Код едет вместе с текстом (`ApiError`, как у браузерного пути): по нему строка
    // ошибки решает, предложить повтор или начало с первой страницы.
    if (e instanceof Error && e.name === 'AbortError') throw e
    const { error, code, status } = explain(e)
    throw new ApiError({ error, code }, status)
  }
})

/** Отказ слоя → код, статус и текст для человека: один перевод на оба пути. */
function explain(e: unknown): { error: string; code: string; status: number } {
  const kit = toKitError(e, import.meta.env.DEV)
  const code = String(kit.body.code ?? 'database')
  // Тексты слоя по умолчанию — английские («Invalid or expired cursor»), в
  // показ они не идут: только свои слова, неизвестный код — с его именем.
  return { error: EXPLAIN[code] ?? `База отклонила запрос (код ${code}).`, code, status: kit.status }
}

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
    return explain(e)
  }
}

/**
 * Опрос изменённых и удалённых (docs/design/live-update.md §5.2–5.3).
 *
 * Границы `top`/`bottom` — строки выдачи (`<ISO>|<id>`), а не позиции окна: они
 * только СУЖАЮТ выборку, политика и права проверяются как при обычном чтении.
 * Поэтому клиент может прислать границы, но не может ими ничего расширить.
 * Внутри границ спрашиваем то, что новее отметки: `updated_at > since` (строки
 * целиком) и `deleted_at > since` (только ключи — содержимое удалённой строки
 * наружу не идёт). Отметку ответа (`mark`) тоже ставит база: максимум среди
 * найденных меток, иначе прежняя — часы клиента в этом не участвуют.
 */
export async function fetchDbPostsChanges(
  query: { since: string; filter?: string; top?: string; bottom?: string },
  ctx: DataContext,
): Promise<DbPostsChanged | { error: string; code: string; status: number }> {
  try {
    if (query.since !== '' && Number.isNaN(Date.parse(query.since))) {
      return { error: 'Отметка `changed` — не время в формате ISO.', code: 'validation', status: 422 }
    }
    const api = db.resource(posts)
    // Границы — фильтр, а не параметр слоя: `top`/`bottom` в адресе — значения
    // строк выдачи, и слой обязан увидеть их обычным (deny-safe) разбором.
    const bounds: unknown[] = []
    for (const edge of [query.top, query.bottom]) {
      const at = typeof edge === 'string' ? edge.slice(0, edge.lastIndexOf('|')) : ''
      if (!at) continue
      bounds.push({ field: 'created_at', op: edge === query.top ? 'lte' : 'gte', value: at })
    }
    let user: unknown = null
    try {
      user = query.filter ? JSON.parse(query.filter) : null
    } catch {
      // Битый фильтр пусть отвергнет слой своим `validation`, а не мы — 500.
      user = undefined
    }
    if (user === undefined) return { error: 'Фильтр выдачи — не JSON.', code: 'validation', status: 422 }
    const base: unknown[] = [...(user ? [user] : []), ...bounds]
    const filter = base.length ? JSON.stringify(base.length === 1 ? base[0] : { and: base }) : undefined

    // Отметку ставит БАЗА и это «сейчас», а не метка последней найденной
    // строки: с меткой строки окно запаса (клиент спрашивает с `−3 с`) снова
    // накрывало бы ту же правку, и каждый тик возвращал бы её же — вечный 200
    // вместо 304. «Сейчас» сдвигается, и правка уходит за границу окна.
    if (query.since === '') return { items: [], removed: [], mark: await dbNow(ctx) }

    // Запас на границу: транзакция могла записать `updated_at` раньше, чем
    // зафиксировалась. Спрашиваем «новее, чем отметка − запас», отдаём отметку
    // СЫРОЙ; повторно пришедшую строку отсеивает клиент (`mergeChanges`).
    const from = new Date(Date.parse(query.since) - DB_CHANGES_SLACK_MS).toISOString()
    const result = await api.changes(ctx, {
      since: from,
      filter: filter ? (JSON.parse(filter) as never) : undefined,
      limit: DB_FRESH_LIMIT,
    })
    const items = result.updated as DbPost[]
    const removed = result.removed.map(String)
    // Отметка двигается, только когда что-то нашлось: иначе ответ остаётся
    // прежним и условный GET уходит в 304, не читая базу (§5.5).
    return { items, removed, mark: items.length || removed.length ? await dbNow(ctx) : query.since }
  } catch (e) {
    return explain(e)
  }
}

/**
 * «Сейчас» по часам базы: отметка ответа опроса. Часы приложения не участвуют —
 * иначе правка, записанная сервером БД позже нашего ответа, могла бы оказаться
 * «в прошлом» и не прийти никогда.
 */
async function dbNow(ctx: DataContext): Promise<string | null> {
  const rows = (await db.query({ text: 'SELECT clock_timestamp() AS now', ...(ctx.signal ? { signal: ctx.signal } : {}) })).rows
  return isoOf((rows[0] as { now?: unknown } | undefined)?.now)
}

/** `created_at` как строка ISO: драйвер может отдать `Date`, а в адрес едет текст. */
const isoOf = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' && v !== '' ? v : null

/**
 * Опрос «что появилось» — вместо переспроса текущего окна.
 *
 * Переспрос окна сравнивал отпечатки целой страницы: любая запись (в том числе
 * своя, уже стоящая в окне) выглядела как «новое», и список сбрасывался. Здесь
 * вопрос другой — «какие строки выдачи созданы позже отметки»: ответ не зависит ни
 * от номера страницы, ни от порядка, ни от курсора, и своя строка в нём узнаётся
 * по `id`.
 *
 *   `since` пусто  → базовая отметка: `created_at` и `id` самой свежей строки
 *                    выдачи (под тем же фильтром);
 *   `since=<ISO>`  → строки с `created_at > since` под фильтром выдачи, свежие
 *                    первыми, не больше `DB_FRESH_LIMIT`.
 *
 * Условие соединяется с фильтром пользователя через `and` языка слоя: оператор
 * `gt` у `created_at` объявлен ресурсом, поэтому это тот же deny-safe разбор, что
 * у страницы. Точность: драйвер может отдать время с миллисекундами, а база
 * хранит микросекунды, — строка-отметка может прийти в ответе сама; клиент
 * отсеивает её по `markId` и по `id` уже показанных строк.
 */
export async function fetchDbPostsFresh(
  query: { since: string; filter?: string },
  ctx: DataContext,
): Promise<DbPostsFresh | { error: string; code: string; status: number }> {
  try {
    const api = db.resource(posts)
    const params = new URLSearchParams({ order: JSON.stringify([['created_at', 'desc'], ['id', 'asc']]) })
    let filter = query.filter
    if (query.since !== '') {
      const cond = { field: 'created_at', op: 'gt', value: query.since }
      let user: unknown = null
      try {
        user = filter ? JSON.parse(filter) : null
      } catch {
        // Битый фильтр пусть отвергнет слой своим `validation`, а не мы — 500.
        user = undefined
      }
      if (user !== undefined) filter = JSON.stringify(user ? { and: [user, cond] } : cond)
    }
    if (filter) params.set('filter', filter)
    params.set('limit', String(query.since === '' ? 1 : DB_FRESH_LIMIT))
    const rows = (await api.select(ctx, parseListInput(params))) as DbPost[]
    if (query.since !== '') return { items: rows }
    const head = rows[0]
    return { items: [], mark: head ? isoOf(head.created_at) : null, markId: head ? String(head.id) : null }
  } catch (e) {
    return explain(e)
  }
}
