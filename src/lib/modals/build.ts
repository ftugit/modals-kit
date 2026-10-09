// Проводка ЯДРА: связывает среду и ОДИН ИЛИ НЕСКОЛЬКО источников
// в один `ModalCore`.
//
// Это внутренняя кухня ядер, а не публичный API. Снаружи видно только
// `ядро(хранилище)` — например `svelteKitCore(urlStorage())` или
// `svelteKitCore({ url: urlStorage(), memory: memoryStorage() })`.
//
// 🔴 Ключевое ограничение нескольких источников: **порядок живёт в одном
// месте** — в состоянии записи истории. Если бы каждый источник хранил
// свою часть и они склеивались «по порядку установки», только что
// открытая модалка уезжала бы под старую. Порядок стопки — по времени
// открытия, поэтому он общий, а источники хранят только содержимое.
import { chainEquals } from './core'
import { assertTransientOnTop, type Chain, type ModalCore, type WriteOptions } from './core-contract'
import type { ChainEngine } from './engine'
import type { ChainStorage } from './storages'
import type { AnyDefinition } from './registry'
import type { ChainOverrides, RegisteredEntry, TransientEntry } from './types'

/** Ключ нашего состояния внутри состояния записи истории. */
export const STATE_KEY = 'modals'

/** Позиция записи в общем порядке: источник + индекс внутри него. */
interface OrderRef {
  s: string
  i: number
}

interface StateShape {
  transient?: Array<{ id: string; overrides: ChainOverrides }>
  /** Зеркало неадресуемых источников — чтобы работали Назад/Вперёд. */
  mirror?: Record<string, RegisteredEntry[]>
  /** Общий порядок стопки. Без него источники склеиваются по объявлению. */
  order?: OrderRef[]
  depth?: number
}

export interface CoreOptions {
  /** Разрешение имён. Обычно `registry.lookup` нужной области видимости. */
  lookup?: (name: string) => AnyDefinition | undefined
}

/** Один источник или именованный набор. */
export type Sources = ChainStorage | Record<string, ChainStorage>

/**
 * Что делать с записями источника, которого больше нет в наборе.
 *
 * `degrade` (умолчание) — переселить в оставшийся источник. Переконфигурация
 * это не действие пользователя, поэтому она не должна уничтожать видимое
 * состояние: молчаливая пропажа записи хуже переезда.
 *
 * `close` — выбросить. Осознанный выбор для записей, бессмысленных без
 * своего источника.
 */
export type OrphanPolicy = 'degrade' | 'close'

/** Что можно сменить на лету, не пересоздавая ядро. */
export interface CoreReconfigure {
  sources?: Sources
  lookup?: (name: string) => AnyDefinition | undefined
  /** Судьба записей исчезнувших источников. По умолчанию `degrade`. */
  orphans?: OrphanPolicy
}

/**
 * Ядро, умеющее менять конфигурацию на месте.
 *
 * Возможность объявлена НАЛИЧИЕМ МЕТОДА (идиома core-contract), поэтому
 * контракт расширять не пришлось: кто умеет — отдаёт `reconfigure`.
 *
 * 🔴 Зачем вообще: пересоздание ядра роняет всё, что к нему привязано —
 * открытые слои, floating-оверлеи, фокус. Набор источников меняется
 * редко, но это не повод терять видимое состояние.
 */
export interface ReconfigurableCore extends ModalCore {
  reconfigure(next: CoreReconfigure): void
}

/** Умеет ли ядро менять конфигурацию без пересоздания. */
export function isReconfigurable(core: ModalCore): core is ReconfigurableCore {
  return typeof (core as ReconfigurableCore).reconfigure === 'function'
}

interface Named {
  name: string
  storage: ChainStorage
}

function normalize(input: Sources): Named[] {
  if (typeof (input as ChainStorage).read === 'function') {
    const s = input as ChainStorage
    return [{ name: s.name, storage: s }]
  }
  return Object.entries(input as Record<string, ChainStorage>).map(([name, storage]) => ({
    name,
    storage,
  }))
}

/** Собирает reconfigurable ModalCore из движка истории и одного либо нескольких источников. */
export function buildCore(
  engine: ChainEngine,
  sources: Sources,
  options: CoreOptions = {},
): ReconfigurableCore {
  let lookup = options.lookup ?? (() => undefined)
  const listeners = new Set<(c: Chain) => void>()

  // 🔴 Изменяемые, а не `const`: именно их замороженность заставляла
  // пересоздавать ядро при смене набора источников. Сами записи тут
  // не живут — они выводятся из адреса и состояния записи истории,
  // поэтому смена источников НЕ переносит данные, а меняет проекцию.
  let all = normalize(sources)
  let byName = new Map(all.map((n) => [n.name, n]))
  let fallback = all[0]
  // Адрес формирует первый адресуемый источник; остальные в него не пишут.
  let addressable = all.find((n) => n.storage.addressable)

  // Разрешение имён читается через замыкание: `scope` тоже меняется на лету.
  const env = { location: () => engine.location(), lookup: (name: string) => lookup(name) }
  const readState = (): StateShape => (engine.state()?.[STATE_KEY] ?? {}) as StateShape

  /** Писала ли эта система хоть раз. До первой записи верим содержимому источников. */
  let everWrote = false

  /** Куда писать запись: по определению модалки, иначе источник по умолчанию. */
  const sourceFor = (name: string): string => {
    const declared = lookup(name)?.source
    if (typeof declared === 'string') return byName.has(declared) ? declared : fallback.name
    if (Array.isArray(declared)) {
      const first = declared.find((s) => byName.has(s))
      if (first) return first
    }
    return fallback.name
  }

  /* ── чтение ──────────────────────────────────────────────────────── */

  const readTransient = (): TransientEntry[] =>
    (readState().transient ?? []).map((t) => ({
      kind: 'transient' as const,
      id: t.id,
      overrides: t.overrides ?? {},
    }))

  /**
   * Записи каждого источника, помеченные его именем.
   *
   * Источник помечает запись сам — поэтому `source` не приходится
   * сериализовать: он выводится из того, кто её отдал.
   */
  const readPerSource = (): Map<string, RegisteredEntry[]> => {
    const state = readState()
    const out = new Map<string, RegisteredEntry[]>()
    for (const { name, storage } of all) {
      // У неадресуемых источников приоритет у зеркала в записи истории:
      // оно знает, где мы сейчас в Назад/Вперёд.
      //
      // Когда зеркала нет, важно различить два случая:
      //
      //   мы ещё ни разу не писали — первый заход или начальное
      //   содержимое источника → верим носителю;
      //
      //   писали, а тут пусто (например ушли Назад) → пусто.
      //
      // Различаем именно «писали ли вообще», а не «писали ли на этой
      // записи истории»: недолговечный носитель мутируется глобально,
      // и шаг назад его не откатывает — он отдал бы устаревшее.
      // На этом ловился дубль записи после `closeAll()`.
      // Зеркало в записи истории ПЕРЕЖИВАЕТ перезагрузку, а содержимое
      // недолговечного носителя — нет. Поэтому до первой записи в этой
      // сессии зеркалу верить нельзя: иначе memory «воскресал» после F5.
      const mirror = state.mirror?.[name]
      const raw = storage.addressable
        ? storage.read(env)
        : !everWrote
          ? // В этой сессии мы ещё не писали. Если зеркала нет вовсе —
            // это первый заход, и начальному содержимому носителя верим.
            // Если зеркало ЕСТЬ, оно от прошлой сессии вкладки: долговечный
            // носитель его переживёт, недолговечный — нет.
            mirror === undefined
            ? storage.read(env)
            : storage.durable
              ? mirror
              : []
          : // Уже писали: зеркало — единственный источник. Его отсутствие
            // на записи истории значит «здесь было пусто», а не «читай
            // носитель»: иначе шаг Назад воскрешал бы из localStorage
            // модалку, которую только что закрыли.
            (mirror ?? [])
      // Фильтра «разрешено ли имя здесь» нет намеренно: `source`
      // у определения — это РАЗМЕЩЕНИЕ по умолчанию, а не разрешение.
      // Фильтр конфликтовал с явным `open(name, { source })` и молча
      // ронял такую запись; молчаливая пропажа хуже чужой записи,
      // тем более что источники наполняет наш же код.
      out.set(name, raw.map((e) => ({ ...e, source: name })))
    }
    return out
  }

  const read = (): Chain => {
    const per = readPerSource()
    const order = readState().order
    const registered: RegisteredEntry[] = order
      ? order.map((r) => per.get(r.s)?.[r.i]).filter((e): e is RegisteredEntry => Boolean(e))
      : all.flatMap((n) => per.get(n.name) ?? [])
    return [...registered, ...readTransient()]
  }

  /* ── запись ──────────────────────────────────────────────────────── */

  const hasHistory = typeof engine.go === 'function'

  /** Реализация href живёт отдельно: ключ в ядре то появляется, то исчезает. */
  const hrefForImpl = (chain: Chain): string | null => {
    const target = addressable
    if (!target) return null
    // Слой без адреса ссылкой не передать — честнее не дать href вовсе.
    if (chain.some((e) => e.kind === 'transient')) return null
    const mine = chain.filter(
      (e): e is RegisteredEntry =>
        e.kind === 'registered' && (e.source ?? sourceFor(e.name)) === target.name,
    )
    return target.storage.urlFor(mine, env)
  }

  const core: ReconfigurableCore = {
    // Геттеры, а не снимки: после `reconfigure` ядро обязано отвечать
    // по НОВОМУ набору источников, оставаясь тем же объектом.
    get lookup() {
      return lookup
    },
    get name() {
      return `${engine.name}(${all.map((n) => n.name).join('+')})`
    },

    get capabilities() {
      return {
        addressable: Boolean(addressable),
        transient: true,
        history: hasHistory,
      }
    },

    read,

    write(chain, opts?: WriteOptions) {
      assertTransientOnTop(chain)
      everWrote = true
      const registered = chain.filter((e): e is RegisteredEntry => e.kind === 'registered')
      const transient = chain.filter((e): e is TransientEntry => e.kind === 'transient')

      // 1) разложить по источникам, сохранив общий порядок
      const groups = new Map<string, RegisteredEntry[]>(all.map((n) => [n.name, []]))
      const order: OrderRef[] = []
      for (const e of registered) {
        const s = e.source && byName.has(e.source) ? e.source : sourceFor(e.name)
        const group = groups.get(s)!
        order.push({ s, i: group.length })
        group.push({ ...e, source: s })
      }

      // 2) каждый источник пишет своё
      for (const { name, storage } of all) storage.commit?.(groups.get(name)!, env)

      // 3) адрес формирует только адресуемый источник
      const url = addressable
        ? addressable.storage.urlFor(groups.get(addressable.name)!, env)
        : engine.location().pathname + engine.location().search

      // 4) зеркало неадресуемых — иначе Назад не откатывает их содержимое
      const mirror: Record<string, RegisteredEntry[]> = {}
      for (const { name, storage } of all) {
        if (!storage.addressable) mirror[name] = groups.get(name)!
      }

      const mine: StateShape = {
        depth: chain.length,
        order,
        ...(Object.keys(mirror).length > 0 ? { mirror } : null),
        ...(transient.length > 0
          ? { transient: transient.map((t) => ({ id: t.id, overrides: t.overrides })) }
          : null),
      }
      // Состояние записи может быть общим с чужим кодом, поэтому сливаем,
      // а не затираем целиком.
      const state = { ...engine.state(), [STATE_KEY]: mine }

      if (url !== null) {
        if (opts?.replace) engine.replaceState(url, state)
        else engine.pushState(url, state)
      }

      notify()
    },

    subscribe(listener) {
      listeners.add(listener)
      const off = engine.onPopState?.(notify)
      return () => {
        listeners.delete(listener)
        off?.()
      }
    },

    back: hasHistory
      ? (steps, chain) => {
          // Шаг назад — такое же намеренное изменение состояния, как запись:
          // дальше зеркало обязано быть единственным источником. Без этого
          // после перезагрузки `closeAll()` воскрешал слой из localStorage,
          // потому что на старой записи истории зеркала нет, а носитель
          // ещё хранил прежнее значение.
          everWrote = true
          const depth = readState().depth ?? 0
          // Шаг считаем по метке глубины, а не по `steps`: в истории могли
          // остаться записи слоёв, которых уже нет.
          const available = Math.max(0, depth - chain.length)
          if (available > 0) engine.go!(-available)
          else core.write(chain, { replace: true })
        }
      : undefined,

    // Наличие метода — это возможность (см. core-contract). Поэтому при
    // отсутствии адресуемого источника ключа нет вовсе, а не есть метод,
    // возвращающий null: «нечестный href хуже отсутствующего».
    // `reconfigure` добавляет и убирает ключ через syncHrefFor().
    ...(addressable ? { hrefFor: hrefForImpl } : null),

    preload: engine.preload ? (href) => engine.preload!(href) : undefined,
    resolves: engine.resolves ? (href) => engine.resolves!(href) : undefined,

    /**
     * Сменить источники и/или разрешение имён, не пересоздавая ядро.
     *
     * Записи не переносятся: их хранит не источник, а адрес и состояние
     * записи истории (`readPerSource`). Источник — проекция, поэтому
     * переконфигурация меняет то, ЧЕРЕЗ ЧТО мы читаем и пишем, а не то,
     * ЧТО прочитано.
     *
     * Идемпотентна: тот же набор имён и тот же `lookup` — не делаем ничего,
     * иначе `$effect` в layout зациклился бы на собственном уведомлении.
     */
    reconfigure(next: CoreReconfigure) {
      const nextLookup = next.lookup ?? lookup
      const nextAll = next.sources ? normalize(next.sources) : all

      const sameLookup = nextLookup === lookup
      const sameSources =
        nextAll.length === all.length &&
        nextAll.every((n, i) => n.name === all[i].name && n.storage === all[i].storage)
      if (sameLookup && sameSources) return

      // Цепочку читаем ДО переключения: после него записи исчезнувшего
      // источника уже не прочитаются, и спасать будет нечего.
      const kept = new Set(nextAll.map((n) => n.name))
      const gone = all.filter((n) => !kept.has(n.name)).map((n) => n.name)
      const before: Chain = gone.length > 0 ? read() : []

      lookup = nextLookup
      all = nextAll
      byName = new Map(all.map((n) => [n.name, n]))
      fallback = all[0]
      addressable = all.find((n) => n.storage.addressable)
      // Адресуемость могла появиться или исчезнуть — значит обязан
      // появиться или исчезнуть и сам метод, иначе `canLink()` соврёт.
      if (addressable) core.hrefFor = hrefForImpl
      else delete core.hrefFor

      // Записи исчезнувших источников: переселяем или выбрасываем.
      const orphaned =
        gone.length > 0 &&
        before.some((e) => e.kind === 'registered' && gone.includes(e.source ?? ''))

      if (orphaned) {
        const policy = next.orphans ?? 'degrade'
        const rescued: Chain =
          policy === 'close'
            ? before.filter((e) => e.kind !== 'registered' || !gone.includes(e.source ?? ''))
            : before.map((e) =>
                e.kind === 'registered' && gone.includes(e.source ?? '')
                  ? // Новый дом выбираем по тем же правилам, что и при открытии:
                    // объявленный источник, если он уцелел, иначе источник
                    // по умолчанию. Запись остаётся видимой — меняется только
                    // то, через что она хранится.
                    { ...e, source: sourceFor(e.name) }
                  : e,
              )
        // replace: переконфигурация не действие пользователя, лишней записи
        // в истории она порождать не должна — иначе «Назад» уехало бы в неё.
        lastNotified = null
        core.write(rescued, { replace: true })
        return
      }

      // Цепочка могла измениться: исчезнувший источник больше не читается.
      // Сбрасываем эхо-гард, чтобы подписчики гарантированно узнали новое
      // состояние даже если значение совпало с прошлым уведомлением.
      lastNotified = null
      notify()
    },
  }

  /**
   * Эхо-гард: одни среды уведомляют о смене адреса сами (FastEdge),
   * другие нет. `write()` уведомляет всегда, а повтор той же цепочки
   * отсекается сравнением по значению.
   */
  let lastNotified: Chain | null = null
  function notify() {
    const c = read()
    if (lastNotified !== null && chainEquals(lastNotified, c)) return
    lastNotified = c
    reconcile(c)
    for (const fn of listeners) fn(c)
  }

  /**
   * Приводит носители в соответствие с текущей цепочкой.
   *
   * Закрытие — это шаг НАЗАД по истории, а шаг по истории носителя
   * не касается: в localStorage оставалась запись закрытой модалки,
   * и после перезагрузки она возвращалась. Адресуемый источник этим
   * не страдает — у него носитель и есть адрес.
   */
  function reconcile(chain: Chain) {
    if (!everWrote) return
    for (const { name, storage } of all) {
      if (storage.addressable || !storage.commit) continue
      storage.commit(
        chain.filter(
          (e): e is RegisteredEntry => e.kind === 'registered' && e.source === name,
        ),
        env,
      )
    }
  }

  return core
}
