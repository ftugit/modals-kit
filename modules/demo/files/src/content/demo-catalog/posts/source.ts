/**
 * Список демо-записей через пагинатор приложения (`#lib/paginate/index.js`), а не через
 * собственную разметку «slice + ссылки».
 *
 * ЭТОТ МОДУЛЬ — ОБЩИЙ для двух демо-страниц: `/db-demo` (витрина работы с БД:
 * формы, notice, сырая строка) и раздела «пагинатор» (там «БД» — один из пунктов
 * списка источников). Разных реализаций списка быть не должно, различаются только
 * панели; расширение (чат-режим, моментальная строка) заводится здесь и сразу
 * видно обоим.
 *
 * Ключи адреса — общие для приложения: `?page=2`, `?page.size=10`,
 * `?page.flt=<фильтр слоя>`, `?page.ord=<json>`, `?page.cur=1`,
 * `?page.after=<токен слоя>`. Своих имён (`?db*`) здесь намеренно нет: `pageParam`
 * по умолчанию = `page`, и переопределять его ради одного потребителя значит
 * заставлять адрес говорить двумя диалектами. Разбор адреса принадлежит
 * пагинатору, поэтому `+page.server.ts` не читает `?limit`/`?filter` сам — второго
 * источника правды о показанной странице быть не должно.
 *
 * Две дороги к одним данным, один конвейер:
 *   • браузер — `fetch('/api/db-posts?…')`;
 *   • SSR-снапшот — серверный транспорт (`setDbPostsServerTransport`), который
 *     ставит `#lib/server/db-list.js` и который вызывает слой напрямую. Без него
 *     серверный рендер дёргал бы собственный HTTP-эндпоинт через `localhost`.
 *
 * Страница или поток — режим ИСТОЧНИКА (`?page.cur=1`), а не страницы: источник
 * понимает оба адреса (`?page` → offset, `?page.after` → keyset), и ни одна из
 * страниц не выбирает транспорт руками.
 */
import { responseError } from '#hooks/api-error.js'
import { fetchWithTask } from '#lib/fetch/index.js'
import {
  createUrlAdapter,
  decorateSource,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  type Extra,
  type ExtraSearchSpec,
  type ExtraSearchValidator,
  type ExtraValue,
  type PageResponse,
  type PaginatorAdapter,
  type SourceDecorator,
  type SourceInput,
  type SourceLook,
} from '#lib/paginate/index.js'

export const DB_LIST_NAME = 'db-demo'
export const DB_LIST_PAGE_SIZE = 5
export const DB_LIST_PAGE_SIZES = [3, 5, 10, 20] as const

/** Ключ тумблера «курсор вместо номеров страниц» и ключ указателя следующего шага. */
export const DB_LIST_MODE_KEY = 'cur'
export const DB_LIST_POINTER_KEY = 'after'

/**
 * Ключи, которые источник понимает: фильтр, порядок, указатель следующего шага и
 * срез «на момент» (`asof`). Список ОДИН — по нему сверяются и спека источника, и
 * обёртка для union-типа демо-пагинатора; разойтись они не вправе (иначе ключ
 * доедет до одного мира и не доедет до другого).
 *
 * `asof` здесь — не «позиция» источника, а вход: среди `positionKeys` пагинатора
 * он означает «новая выдача начинается с нового края», но до данных он доезжает
 * тем же путём, что и указатель (иначе страница 2 под срезом молча теряла срез и
 * сдвигалась под читателем).
 */
export const DB_LIST_FILTER_KEYS = ['flt', 'ord', DB_LIST_MODE_KEY, DB_LIST_POINTER_KEY, 'asof'] as const

export interface DbPost {
  id: string
  title: string
  /** Адрес записи: модель заполняет его из заголовка (`fill`); у сида — `null`. */
  slug?: string | null
  created_at: string
  /** Ставит база (`timestamps`); по нему опрос узнаёт изменённые (§5.2). */
  updated_at?: string | Date
  /** Мягкое удаление: по нему опрос узнаёт удалённые (§5.3). */
  deleted_at?: string | Date | null
}

/**
 * Строка для ПОКАЗА: оптимистичной карточке не хватает `created_at` (его назначает
 * сервер), а компонента строки одна — иначе «моментальная» строка выглядела бы
 * иначе, чем пришедшая с сервера, и демо проверяло бы не то.
 */
export type DbPostView = { id: string; title: string; slug?: string | null; created_at?: string }

/** Отказ записи: убрать карточку или оставить с повтором (см. `LIVE-APPEND.md`, Р5). */
export type FailureMode = 'remove' | 'retry'

/** Запрос страницы в том виде, в каком его понимает слой (`parseListInput`). */
/**
 * Ответ опроса «что появилось» (`/api/db-posts?since=…`).
 * Базовый запрос (`since=` пусто) — `mark`/`markId`: отметка самой свежей строки
 * выдачи, `items` пусты. Запрос с отметкой — строки новее неё, свежие первыми,
 * не больше `DB_FRESH_LIMIT`.
 */
export type DbPostsFresh = { items: DbPost[]; mark?: string | null; markId?: string | null }
/** Потолок строк в ответе опроса: больше — «50+», пилюля честно говорит «много». */
export const DB_FRESH_LIMIT = 50
/** Запас у отметки изменённых: правка, зафиксированная чуть позже своей метки. */
export const DB_CHANGES_SLACK_MS = 3_000

/**
 * Ответ опроса изменённых (§5.2–5.3 плана live-update): что поменялось в
 * показанном куске и что из него удалили. `mark` — отметка ответа: следующий
 * вопрос задаётся от неё (её ставит база, а не часы клиента).
 */
export type DbPostsChanged = { items: DbPost[]; removed: string[]; mark?: string | null }

export type DbPostsQuery = {
  /** Номер страницы (offset). Не используется, когда задан `after`. */
  page: number
  pageSize: number
  filter?: string
  order?: string
  /** Подписанный сервером указатель «продолжить отсюда» — keyset-режим. */
  after?: string
  /**
   * Режим курсора включён, но токена ещё нет (первый шаг). Без этого флага
   * keyset включался бы только со второго шага, и первая страница cursor-режима
   * не получала бы указателя — «дальше» не появилось бы никогда.
   */
  cursor?: boolean
  /** Срез «на момент» (`<ISO>|<id>`): выдача не новее этой строки. Только страницы. */
  asof?: string
  signal?: AbortSignal
}

export type ServerTransport = (query: DbPostsQuery) => Promise<PageResponse<DbPost>>

let serverTransport: ServerTransport | null = null

/** Ставится один раз на уровне модуля серверным слоем (см. `#lib/server/db-list.js`). */
export function setDbPostsServerTransport(fn: ServerTransport): void {
  serverTransport = fn
}

/**
 * Порядок слоя — массив пар `[["title","asc"]]` (не `title:asc`): адрес хранит
 * ровно то, что разбирает `parseListInput`, иначе на странице и в догрузке
 * были бы разные правила. Здесь проверяется только ФОРМА (короткий массив пар с
 * asc/desc), допустимость поля и направление разбирает слой.
 */
/** Значение «порядок по умолчанию»: панель обязана УМЕТЬ снять свой выбор. */
export const DB_LIST_ORDER_DEFAULT = 'default'

function isOrderSpec(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return false
  }
  return (
    Array.isArray(parsed) &&
    parsed.length <= 2 &&
    parsed.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (pair[1] === 'asc' || pair[1] === 'desc'))
  )
}

/**
 * Форма токена: длина и алфавит. Подлинность токена проверяет слой (HMAC + TTL
 * + scope порядка/фильтра), поэтому здесь нет и не может быть «разбора» курсора:
 * клиенту он недоступен намеренно.
 */
function isCursorToken(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_\-/.=+]+$/.test(value)
}

/** Собственно признак «тумблер включён» — ОДНО определение для адреса и состояния. */
function isCursorValue(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === 'true' || raw === '1' || raw === 'on'
}

/**
 * Значение тумблера режима «как есть»: и `true` (панель через JS), и строки,
 * которые приносит адрес (`on` из чекбокса нативного GET, `1`, `true`). Тот же
 * набор принимает валидатор ключа — иначе состояние и ссылка разошлись бы.
 */
export function isCursorOn(extra: Extra | undefined): boolean {
  return isCursorValue(extra?.[DB_LIST_MODE_KEY])
}

/**
 * Валидатор `?page.cur` — ОДИН на оба демо (`/db-demo` и панель пагинатора):
 * «источник тот же» перестаёт быть правдой, если на двух страницах один и тот же
 * адресный ключ трактуется по-разному.
 */
export const cursorExtraField: ExtraSearchValidator = (raw) => (isCursorValue(raw) ? true : undefined)

/**
 * Тумблер живого списка — тем же словарём значений, что и режим курсора: два
 * чекбокса в одной панели, разбираемые по-разному, были бы подарком для
 * «у меня в адресе работает, а у вас нет».
 */
export const liveExtraField: ExtraSearchValidator = (raw) => (isCursorValue(raw) ? true : undefined)

/** Ключ `?page.live` — опрос текущего окна (см. `docs/LIVE-APPEND.md`, Р6). */
export const DB_LIST_LIVE_KEY = 'live'

/** Валидатор указателя следующего шага — тем же словарём пользуется и демо пагинатора. */
export const cursorPointerField: ExtraSearchValidator = extraField('text', isCursorToken)

/** Валидатор среза `<ISO>|<id>` — общий для `/db-demo` и демо пагинатора (`src=db`). */
export const asofExtraField: ExtraSearchValidator = extraField(
  'text',
  (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 && v.includes('|'),
)

/** Валидатор ключа начала видимой курсорной порции (`beg`). */
export const cursorBeginField: ExtraSearchValidator = extraField(
  'text',
  (v) => typeof v === 'string' && v.length <= 4096,
)

/** Внутренние ключи состояния среза (не пишутся в URL). */
export const DB_SLICE_INTERNAL_KEYS = ['asofHead', 'headAt', 'begAt'] as const

/** Позиционные ключи среза и курсора — сбрасываются при `reset()` и смене условий выдачи. */
export const DB_SLICE_POSITION_KEYS = [
  DB_LIST_POINTER_KEY,
  'asof',
  'beg',
  ...DB_SLICE_INTERNAL_KEYS,
] as const

/** Ключи `?page.<key>`: форма проверяется здесь, допустимость — на сервере (схема слоя). */
export const DB_LIST_EXTRA_SEARCH: ExtraSearchSpec = {
  // JSON-фильтр слоя: длина ограничена, содержимое разбирает `parseListInput`.
  flt: extraField('text', (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048),
  // Порядок: ЛИБО маркер «как в слое», ЛИБО JSON-спека. Маркер нужен затем, чтобы
  // снятие выбора было реальным значением: пустая строка в панели означает «ключ не
  // трогаем», и вернуть порядок по умолчанию из `?page.ord=[…]` было бы нельзя.
  ord: extraField('text', (v) => v === DB_LIST_ORDER_DEFAULT || isOrderSpec(v)),
  // Режим навигации: влияет на то, КАК читается выдача, поэтому в `reloadKeys`.
  // Валидатор свой, а не `extraField('boolean')`: чекбокс в нативном GET приезжает
  // как `on` (см. `builtins.ts` формы), и «только настоящий boolean» отсёк бы
  // именно no-JS путь. Снятый флаг = ключа в адресе нет = дефолт `false`.
  [DB_LIST_MODE_KEY]: cursorExtraField,
  // Указатель следующего шага: результат выдачи, а не её условие — в `reloadKeys`
  // его нет (иначе каждый ответ сбрасывал бы список на сам себя). Сбрасывается он
  // через `positionKeys`: пересборка окна по `flt`/`ord`/`cur` снимает его, потому
  // что токен привязан к тому окну и к тому порядку, на которых его выдали.
  [DB_LIST_POINTER_KEY]: cursorPointerField,
  // Что делать с оптимистичной карточкой при отказе. На выдачу не влияет — в
  // `reloadKeys` его нет по той же причине, что и `size`.
  err: extraField('text', (v) => v === 'remove' || v === 'retry'),
  // Живой список: влияет только на то, переспрашивает ли страница источник, —
  // поэтому НЕ в `reloadKeys` (само включение не должно ронять окно).
  [DB_LIST_LIVE_KEY]: liveExtraField,
  // Срез «на момент»: `<ISO>|<id>` самой свежей строки выдачи. Это не условие
  // пользователя, а закреплённый край выдачи — ядро сбрасывает его вместе с
  // указателем (`positionKeys`), а ответ сервера ставит заново.
  asof: asofExtraField,
  // Ключ НАЧАЛА выданной порции курсора: ответ сервера, а не ввод пользователя.
  // В адрес его пишет `after` (см. `withDbSliceKeys`), а `beg` живёт в состоянии:
  // так перезагрузка знает, какую порцию показывать. Без объявления здесь он не
  // доехал бы из снапшота SSR. Значения по умолчанию у него НЕТ (см. ниже):
  // отсутствие ключа в адресе не должно превращаться в «порция с головы».
  beg: cursorBeginField,
}

/** Дефолты extra: ключ со значением по умолчанию в адрес не пишется (чистый URL). */
export const DEFAULT_DB_LIST_EXTRA = {
  [DB_LIST_MODE_KEY]: false,
  [DB_LIST_POINTER_KEY]: '',
  ord: DB_LIST_ORDER_DEFAULT,
  // «повторить» по умолчанию: потерять введённое при сетевом сбое обиднее, чем
  // увидеть карточку с кнопкой.
  err: 'retry' as FailureMode,
  [DB_LIST_LIVE_KEY]: false,
  asof: '',
}

export type DbListExtra = {
  flt?: string
  ord: string
  cur: boolean
  after: string
  err: FailureMode
  live: boolean
  asof: string
}

/** Значения панели настроек — из текущего extra (тот же разбор, что и на адресе). */
export function dbListExtraOf(extra: Record<string, unknown> | undefined): DbListExtra {
  const out: Record<string, unknown> = { ...DEFAULT_DB_LIST_EXTRA }
  for (const key of Object.keys(DB_LIST_EXTRA_SEARCH)) {
    const validate = DB_LIST_EXTRA_SEARCH[key]!
    const v = validate(extra?.[key] as ExtraValue)
    if (v !== undefined) out[key] = v
  }
  return out as DbListExtra
}

/**
 * Страница данных: транспорт и перевод ключей. Общая для `dbPostsSource` (список
 * `/db-demo`) и для обёртки демо-пагинатора, где запись — часть union'а: разной
 * логики выдачи на две страницы здесь нет намеренно.
 */
export async function fetchDbPosts(look: SourceLook, input: SourceInput): Promise<PageResponse<DbPost>> {
  const filter = input.filters?.flt
  const rawOrder = input.filters?.ord
  const order = rawOrder && rawOrder !== DB_LIST_ORDER_DEFAULT ? rawOrder : undefined
  // Признак режима читается ТЕМ ЖЕ предикатом, что адрес и состояние: значение
  // фильтра — строка (`resolveFilters` приводит её через String), а из панели
  // прилетает boolean, из нативного GET — 'on'. Три формы, одно значение.
  const cursorOn = isCursorOn(input.filters)
  // Указатель значит что-то только внутри режима: осевший в адресе `?page.after`
  // при выключенном тумблере не превращает постраничный список в keyset (иначе
  // «номера страниц» и «данные по токену» показывались бы одновременно).
  const after = cursorOn ? input.filters?.[DB_LIST_POINTER_KEY] : undefined
  // Срез значит что-то только в постраничном режиме: у курсора край закреплён
  // закладками, и второй механизм «на момент» спорил бы с первым.
  const asof = cursorOn ? undefined : (input.filters?.asof as string | undefined)
  // Один разбор на оба транспорта: серверный вызов слоя и HTTP идут с теми же
  // ключами, поэтому «страница» и «догрузка» не могут разойтись по-тихому.
  if (serverTransport)
    return serverTransport({
      page: look.page,
      pageSize: look.pageSize,
      filter,
      order,
      after: after || undefined,
      cursor: cursorOn,
      asof,
      signal: look.signal,
    })
  const q = new URLSearchParams({ size: String(look.pageSize) })
  // Слой отказывает, когда `page` и `after` смешаны, поэтому транспорт выбирается
  // здесь и только здесь: токен есть — номера в запросе нет.
  if (after) q.set(DB_LIST_POINTER_KEY, after)
  else q.set('page', String(look.page))
  if (asof) q.set('asof', asof)
  // Режим едет отдельным ключом: сервер по нему включает keyset и на первом шаге,
  // где токена ещё не существует.
  if (cursorOn) q.set(DB_LIST_MODE_KEY, '1')
  if (filter) q.set('flt', filter)
  if (order) q.set('ord', order)
  // Первый запрос будит базу (подключение, сверка схемы): ход — строками ответа.
  const res = await fetchWithTask(`/api/db-posts?${q}`, { signal: look.signal, onTask: look.report })
  // Ошибка сервера обязана дойти до пагинатора как ошибка: пустой список он
  // читает как «данных нет», и это другое состояние.
  if (!res.ok) throw await responseError(res, 'db-posts')
  return (await res.json()) as PageResponse<DbPost>
}

export const dbPostsSource = defineSource<DbPost>({
  name: 'db_demo_posts',
  record: {
    id: (r) => String(r.id),
    title: (r) => r.title,
    texts: (r) => [r.title, String(r.id)],
  },
  // Фильтры объявляет САМ источник: ключи `?page.flt`/`?page.ord`/`?page.after`
  // доходят до `data` через `input.filters`; необъявленный ключ пагинатор отсекает.
  // `after` здесь не «фильтр данных», а единственный способ передать источнику
  // указатель, который он сам же и выдал: слой источника не читает адрес напрямую.
  filters: DB_LIST_FILTER_KEYS,
  totals: true,
  data: (look, input) => fetchDbPosts(look, input),
})

/**
 * Курсор как возможность источника: при `?page.cur=1` полных totals нет (счётчик
 * страниц был бы вторым запросом на каждый шаг), поэтому номерная навигация и
 * опция «известное число страниц» выключаются САМИМ слоем возможностей, а не
 * решением разметки. Данные при этом те же самые: меняется только то, чем список
 * пользуется.
 */
export function withDbCursor<T>(): SourceDecorator<T> {
  return decorateSource<T>({
    capabilitiesFor: (base, extra) => {
      const caps = base.capabilitiesFor(extra)
      return isCursorOn(extra) ? { ...caps, totals: false } : caps
    },
    fetchPage: (base, look, extra) => base.fetchPage(look, extra),
  })
}

/**
 * Курсорный источник — он же для `/db-demo`, он же (через `defineSource` с тем же
 * `fetchDbPosts`) для пункта «БД» в демо пагинатора, где запись — часть union'а.
 */
export const dbPostsCursorSource = dbPostsSource.with(withDbCursor<DbPost>())

/**
 * Закладка НАЧАЛА каждой порции курсора, как её видит читатель.
 *
 * В состоянии пагинатора `extra.after` — указатель следующей догрузки (закладка
 * конца последней загруженной порции). В АДРЕСЕ по канону (§4.2 плана
 * live-update) лежит другое: закладка начала той порции, которую человек читает.
 * Перезагрузка тогда просит именно её, а не следующую, и прочитанное не теряется.
 *
 * Карта живёт в замыкании адаптера (браузер) и восстанавливается по факту
 * загрузок: на входе `loadPage` известен ключ, с которым запросили порцию, а
 * ответ несёт ключ следующей. Ядро о подмене не знает и не должно знать: для
 * него `after` остаётся указателем, а адрес — чужое хранилище со своим форматом.
 */
/**
 * Управление отложенным срезом (`asof`) и закладками курсорных порций (`after`/`beg`/`begAt`).
 *
 * 1. Постраничный режим (`!isCursorOn`):
 *    - на чистой первой странице сервер отдаёт `asofHead`, не выставляя `asof` в адрес;
 *    - ссылки на страницы `2..N` (`hrefFor`) и фактические запросы `page > 1` (`loadPage`)
 *      подставляют `asofHead` в `asof`, закрепляя срез и в состоянии, и в URL;
 *    - при возврате на страницу `1` закреплённый `asof` сохраняется до явного `reset()`.
 * 2. Курсорный режим (`isCursorOn`):
 *    - ведёт карту начала порций (`startOf`) и временную отметку активного среза (`begAt`);
 *    - на чистой первой порции с головы (`page === 1`, без `after`) `begAt` пуст;
 *    - при догрузке следующей порции (`page > 1`) или открытии по токену (`after`) активируется
 *      метка `begAt`, чтобы плашка среза показывала время отсечки и позволяла сбросить поток.
 */
export function withDbSliceKeys<T, ExtraProps extends object = object>(
  base: PaginatorAdapter<T> & ExtraProps,
  opts?: { enabled?: (extra: Extra | undefined) => boolean },
): PaginatorAdapter<T> & ExtraProps {
  const isEnabled = opts?.enabled ?? (() => true)
  /** `page → ключ начала`; `''` — порция с самого начала выдачи. */
  const startOf = new Map<number, string>()
  /** `page → ISO-время начала порции`. */
  const startAtOf = new Map<number, string>()
  const keyOf = (extra: Extra | undefined): string =>
    typeof extra?.[DB_LIST_POINTER_KEY] === 'string' ? (extra[DB_LIST_POINTER_KEY] as string) : ''
  const stripTransientUrlOnly = (extra: Extra): Extra => {
    const out = { ...extra }
    delete out.asofHead
    delete out.headAt
    return out
  }
  return {
    ...base,
    extraKeys: base.extraKeys
      ? () => [...new Set([...(base.extraKeys!() ?? []), ...DB_SLICE_INTERNAL_KEYS])]
      : undefined,
    /**
     * Адрес и состояние расходятся по `after` НАМЕРЕННО: в адресе это ключ
     * видимой порции (его пишет `persist`), в состоянии — указатель следующей
     * догрузки (его даёт ответ). Поэтому адресный `after` в состояние не
     * переносится вовсе; страницу и размер адаптер отдаёт как обычно.
     */
    observeExternal(search) {
      const seen = base.observeExternal?.(search) ?? null
      if (!seen?.restorable) return seen
      if (!isEnabled(seen.restorable.extra) || !isCursorOn(seen.restorable.extra)) return seen
      const extra = { ...seen.restorable.extra }
      delete extra[DB_LIST_POINTER_KEY]
      return { ...seen, restorable: { ...seen.restorable, extra } }
    },
    ...(base.hrefFor
      ? {
          hrefFor(targetPage, ctx) {
            const rawExtra = ctx?.extra ?? {}
            const extra = stripTransientUrlOnly(rawExtra)
            delete extra.begAt
            if (isEnabled(rawExtra) && !isCursorOn(rawExtra)) {
              const patch = ctx?.patch
              const hasExplicitAsofPatch = Boolean(patch && 'asof' in patch)
              const currentAsof = typeof extra.asof === 'string' ? extra.asof : ''
              const head = typeof rawExtra.asofHead === 'string' ? rawExtra.asofHead : ''
              if (targetPage > 1 && !currentAsof && head && !hasExplicitAsofPatch) {
                extra.asof = head
              }
            }
            return base.hrefFor!(targetPage, ctx ? { ...ctx, extra } : { extra })
          },
        }
      : {}),
    async loadPage(req) {
      if (!isEnabled(req.extra)) return base.loadPage(req)
      if (!isCursorOn(req.extra)) {
        startOf.clear()
        startAtOf.clear()
        let nextReq = req
        const currentAsof = typeof req.extra?.asof === 'string' ? req.extra.asof : ''
        const head = typeof req.extra?.asofHead === 'string' ? req.extra.asofHead : ''
        if (req.page > 1 && !currentAsof && head) {
          nextReq = { ...req, extra: { ...req.extra, asof: head } }
        }
        return base.loadPage(nextReq)
      }
      const reqKey = keyOf(req.extra)
      if (req.page === 1 && !reqKey) {
        startOf.clear()
        startAtOf.clear()
      } else if (req.page > 1 && !startOf.has(1)) {
        // В браузере после гидрации из SSR-снапшота карта ещё пуста: 1-я порция
        // была с головы (`''`), если снапшот не нёс своего `beg`.
        const snapBeg = typeof req.extra?.beg === 'string' ? req.extra.beg : ''
        startOf.set(1, snapBeg)
        const snapAt = snapBeg
          ? typeof req.extra?.begAt === 'string'
            ? req.extra.begAt
            : ''
          : typeof req.extra?.headAt === 'string'
            ? req.extra.headAt
            : ''
        if (snapAt) startAtOf.set(1, snapAt)
      }
      const res = await base.loadPage(req)
      const beg = res.extra?.beg
      const resolvedBeg = typeof beg === 'string' ? beg : reqKey
      startOf.set(req.page, resolvedBeg)
      const rawBegAt = typeof res.extra?.begAt === 'string' ? res.extra.begAt : ''
      const rawHeadAt = typeof res.extra?.headAt === 'string' ? res.extra.headAt : ''
      if (req.page === 1) {
        const anchorAt = resolvedBeg ? rawBegAt : rawHeadAt
        if (anchorAt) startAtOf.set(1, anchorAt)
      } else if (rawBegAt) {
        startAtOf.set(req.page, rawBegAt)
      }
      const next = res.extra?.[DB_LIST_POINTER_KEY]
      if (typeof next === 'string' && next) startOf.set(req.page + 1, next)
      else startOf.delete(req.page + 1)

      const activeBegAt = req.page > 1 || resolvedBeg !== '' ? (startAtOf.get(1) ?? rawBegAt) : ''
      return {
        ...res,
        extra: {
          ...(res.extra ?? {}),
          begAt: activeBegAt,
        },
      }
    },
    persist(state) {
      if (!isEnabled(state.extra)) {
        const extra = stripTransientUrlOnly(state.extra)
        delete extra.begAt
        return base.persist({ ...state, extra })
      }
      const cursorOn = isCursorOn(state.extra)
      if (!cursorOn) {
        const extra = stripTransientUrlOnly(state.extra)
        delete extra.begAt
        const head = typeof state.extra.asofHead === 'string' ? state.extra.asofHead : ''
        if (state.page > 1 && !extra.asof && head) {
          extra.asof = head
        }
        return base.persist({ ...state, extra })
      }
      const known =
        startOf.get(state.page) ??
        (typeof state.extra.beg === 'string' && state.extra.beg ? state.extra.beg : undefined)
      const portion = known ?? ''
      const extra = stripTransientUrlOnly(state.extra)
      if (portion === '') {
        delete extra[DB_LIST_POINTER_KEY]
        delete extra.beg
      } else {
        extra[DB_LIST_POINTER_KEY] = portion
        extra.beg = portion
      }
      return base.persist({ ...state, page: 1, extra })
    },
  } as PaginatorAdapter<T> & ExtraProps
}

/** Регистрация идемпотентна: при HMR модуль выполняется повторно. */
export function ensureDbListPaginator(): string {
  if (!hasPaginator(DB_LIST_NAME)) {
    definePaginator<DbPost>({
      name: DB_LIST_NAME,
      pageSize: DB_LIST_PAGE_SIZE,
      // Смена фильтра, порядка или СПОСОБА навигации — новая выдача: сброс на
      // первую страницу. `after` сюда не входит: это указатель, а не условие.
      reloadKeys: ['flt', 'ord', DB_LIST_MODE_KEY],
      // `asof` и позиционные ключи курсора снимаются вместе с указателем: всё это —
      // «где мы стоим в выдаче», а не её условие; при сбросе выдача читается заново.
      positionKeys: DB_SLICE_POSITION_KEYS,
      adapter: withDbSliceKeys(
        createUrlAdapter<DbPost>({
          name: DB_LIST_NAME,
          source: dbPostsCursorSource,
          pageSize: DB_LIST_PAGE_SIZE,
          pageSizes: DB_LIST_PAGE_SIZES,
          // append разрешён всегда: в курсорном режиме список накапливается, а в
          // постраничном пагинатор сам делает REPLACE.
          append: true,
          extraSearch: DB_LIST_EXTRA_SEARCH,
          extraDefaults: DEFAULT_DB_LIST_EXTRA,
        }),
      ),
    })
  }
  return DB_LIST_NAME
}
