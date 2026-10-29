/**
 * Хост шагов — над бронью и алгеброй адреса (`#lib/address/keys`).
 *
 * Шаг — состояние страницы. Хост ЕДИНЫЙ для всех потребителей и не знает ни
 * про формы, ни про содержимое: потребитель нарезает на шаги что угодно —
 * срезы одной формы (`/fields`: поля переносимы между шагами, валидация и
 * отправка общие) или произвольные компоненты (демо `/steps`). Хост решает,
 * где живёт состояние и куда ведут ссылки.
 *
 *  • **Режим `url`** (умолчание) — истина в адресе (`?step=…`), шаги — обычные
 *    ссылки, состояние отдаёт владелец (из данных загрузки/ответа экшена).
 *    Обновление страницы и deep-link работают сами собой.
 *  • **Режим `local`** — состояние внутри хоста, адрес не пишется: смена
 *    шага — `set()`, ни одного обращения к роутеру (модалки). Ссылки в
 *    разметке остаются честными адресными — это fallback без JS.
 *  • **Режим `hybrid`** — локальная смена + мягкая синхронизация адреса
 *    СВОИМ ключом брони (`pushState`, навигации и load нет): обновление
 *    страницы и deep-link остаются верными (страницы). Служебные состояния,
 *    которых нет в списке шагов (у авторизации — `profile`, `blocked`),
 *    адресом не становятся — только локально.
 *  • **Цепочка ключей.** Текущее состояние — полный ключ по уровням
 *    (`auth.restore`): первый сегмент — шаг этого хоста (`currentKey`,
 *    сниппет и навигация смотрят его), остаток — ключи аддонов на шаге
 *    (срезы `formSteps`, вложенные шаги), их читают сами аддоны
 *    (`suffixOf` в `keys.ts`). Хост один на экран и адресует полный ключ
 *    целиком; Steps в steps напрямую не вкладывается — цепочку внутри
 *    шага продолжает только аддон на этом шаге.
 *  • **Чужое не теряется.** Адрес шага строится `nextSearch`: правится только
 *    свой ключ, остальные (`?modal=` цепочка, `?page.…` пагинатора) остаются.
 *  • **Аргументы шага** — как у модалок (`modal.1.pack`): своё семейство
 *    `step.<ключ>.<имя>`, чтение `arg`, правка `argHref`. Права те же: писать
 *    может только владелец брони.
 *  • **Замок полёта отправки** — состояние ЗАПИСИ истории (`page.state`),
 *    не адрес: шаг заперт — ссылка видима, но не кликабельна (`aria-disabled`,
 *    guard на щелчке, `set()` игнорирует). Замок пишет форма, хост показывает.
 *  • **Переход в полёте** — `linkTask` писателя адреса: индикатор честный,
 *    без таймеров, только для перехода именно на этот шаг.
 *  • **Защита (dev):** `set()` в режиме `url` и дубликаты ключей в списке
 *    шагов предупреждают с объяснением — соглашения, которые живут только в
 *    документации, не соблюдаются тем, кто о них не знает.
 */
import { page } from '$app/state'
import { DEV, BROWSER } from 'esm-env'
import { claimQuery, nextSearch, readQuery } from '#lib/address/keys.js'
import { linkTask, visibleAddress, writeAddress } from '#lib/address/sveltekit.js'
import { segmentOf } from './keys.js'

export { segmentOf, suffixOf } from './keys.js'

export type StepDef = {
  key: string
  label: string
  /** Шаг уже заполнен — ссылка; иначе текст, перейти на него нельзя. */
  filled?: boolean
  /**
   * Адресуемость шага в URL (`true` по умолчанию).
   * Служебный шаг с `addressable: false` (подтверждение, итоговая квитанция)
   * отображается в полосе шагов при переходе через `set()`/`switch()`, но не
   * получает прямого `href`, не пишется в `?step=…` и не открывается по прямой ссылке.
   */
  addressable?: boolean
}

/** Где живёт состояние шага. */
export type StepsMode = 'url' | 'local' | 'hybrid'

export type StepItem = {
  key: string
  label: string
  /** Адрес шага или `null` — не заполнен, рисуется текстом. */
  href: string | null
  current: boolean
  /** Полёт отправки: ссылка видима, но не кликабельна. */
  locked: boolean
  /** Переход именно на этот шаг идёт. */
  loading: boolean
  /** Пропсы ссылки: `aria-disabled` и guard на щелчке при замке. */
  props: Record<string, unknown>
}

export type StepsOptions = {
  /** Владелец брони ключа шага (например, «fields»). */
  owner: string
  /** Режим состояния: `url` (умолчание), `local` (модалки), `hybrid` (страницы с локальной сменой). */
  mode?: StepsMode
  /** Ключ шага в адресе. По умолчанию `step`. */
  key?: string
  /** Определения шагов; `filled` считается страницей (она знает данные). */
  steps: () => readonly StepDef[]
  /**
   * Ключ текущего шага. В `url` — читается на каждом обращении (адрес/данные —
   * истина); в `local`/`hybrid` — только НАЧАЛЬНОЕ значение (данные загрузки
   * или deep-link), дальше состоянием ведает `set()`.
   */
  current: () => string | null
  /** Ключ замка полёта в `page.state`; нет — замок не показывается. */
  lockKey?: string
  /**
   * Своя локальная смена шага (побочные данные — seed, аналитика): вызывается
   * ВМЕСТО `set()` при клике по ссылкам хоста (`StepLink`, навигация `Steps`)
   * в режимах local/hybrid. Сама вызывает `set()` (и делает что-то до/вместо).
   * В режиме url не вызывается — там смена нативная навигация.
   */
  onSwitch?: (stepKey: string) => void | Promise<void>
}

export type StepsHost = {
  /** Режим состояния (для рендера: отличить адресную ссылку от локальной смены). */
  readonly mode: StepsMode
  /** Полёт отправки идёт (ссылки видимые, но некликабельные). */
  readonly locked: boolean
  /**
   * Локальная смена шага (`local`/`hybrid`): состояние внутри хоста, в
   * `hybrid` адрес синхронизируется своим ключом брони без навигации.
   * Адресуем полный ключ, чей ПЕРВЫЙ сегмент — из списка шагов
   * (`auth.restore` адресуем, если объявлен `auth`); прочие — служебные
   * состояния владельца, адреса не получают. В режиме `url` —
   * dev-предупреждение: там состоянием ведёт адрес (ссылки), не `set()`.
   * Замок полёта игнорирует смену.
   */
  set(stepKey: string): void
  /**
   * Смена шага ССЫЛКОЙ хоста (`StepLink`, навигация `Steps`): уважает замок,
   * в режимах local/hybrid зовёт `onSwitch` (если задан) или `set()`; в url —
   * dev-предупреждение (там клик не перехватывается, работает нативный переход).
   */
  switch(stepKey: string): Promise<void>
  /** Ключ текущего шага ЭТОГО хоста — первый сегмент полного ключа. */
  readonly currentKey: string | null
  /**
   * Полный ключ цепочки (`auth.restore`): первый сегмент — `currentKey`,
   * остаток — ключи аддонов на шаге. Хост адресует полный ключ целиком;
   * аддоны читают свой остаток (`suffixOf`).
   */
  readonly fullKey: string | null
  /** Адрес шага (чужие ключи адреса не теряются; для `addressable: false` ключ шага в поиск не пишется). */
  href(stepKey: string): string
  /** Разрешён ли шагу собственный URL (`true` для объявленных шагов без `addressable: false`). */
  isAddressable(stepKey: string): boolean
  /** Аргумент шага — чтение (`step.<ключ>.<имя>`); чужие права не нужны. */
  arg(name: string, stepKey?: string): string | undefined
  /** Аргумент шага — правка своим владельцем. */
  argHref(patch: Record<string, string | number | null>, stepKey?: string): string
  /** Элементы навигации, в порядке определения. Реактивно. */
  readonly items: readonly StepItem[]
}

export function useSteps(opts: StepsOptions): StepsHost {
  const mode = opts.mode ?? 'url'
  const key = opts.key ?? 'step'
  // бронь: сам ключ шага и семейство аргументов (`step.fill.id` накрывается `step.*`)
  claimQuery(opts.owner, key, `${key}.*`)

  // локальное состояние режимов local/hybrid; `null` — ещё не меняли, истину
  // отдаёт владелец (начальные данные загрузки / deep-link)
  let local = $state<string | null>(null)
  // эфемерное состояние для неадресуемого шага (`addressable: false`) в режиме `url`:
  // живёт до первой смены адресного `opts.current()`
  let urlEphemeral = $state<{ base: string | null; value: string } | null>(null)
  let urlModeWarned = false
  let dupWarned = false

  const locked = () => (opts.lockKey ? page.state[opts.lockKey] === true : false)
  const guard = (e: Event) => {
    if (locked()) e.preventDefault()
  }

  const findStep = (stepKey: string | null): StepDef | undefined => {
    const seg = segmentOf(stepKey)
    return seg ? opts.steps().find((s) => s.key === seg) : undefined
  }

  const sanitizeColdCurrent = (candidate: string | null): string | null => {
    const def = findStep(candidate)
    if (def?.addressable === false) {
      return opts.steps().find((s) => s.addressable !== false)?.key ?? null
    }
    return candidate
  }

  /** Служебные предупреждения — один раз на хост. */
  const warnOnce = (message: string) => {
    if (DEV) console.warn('[steps] ' + message)
  }
  const checkDup = () => {
    if (dupWarned) return
    const keys = opts.steps().map((s) => s.key)
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
    if (dup.length) {
      dupWarned = true
      warnOnce(`дубликаты ключей шагов у «${opts.owner}»: ${[...new Set(dup)].join(', ')} — списком шагов ведает владелец, каждый ключ один раз`)
    }
  }

  const full = (): string | null => {
    if (mode === 'url') {
      const raw = sanitizeColdCurrent(opts.current())
      if (urlEphemeral && urlEphemeral.base === raw) return urlEphemeral.value
      return raw
    }
    return local ?? sanitizeColdCurrent(opts.current())
  }

  const host: StepsHost = {
    mode,
    get locked() {
      return locked()
    },
    isAddressable(stepKey: string) {
      const def = findStep(stepKey)
      return def !== undefined && def.addressable !== false
    },
    async switch(stepKey: string) {
      if (mode === 'url' && findStep(stepKey)?.addressable !== false) {
        if (!urlModeWarned) {
          urlModeWarned = true
          warnOnce('switch() у «' + opts.owner + '» в режиме url не вызывается: клик по ссылкам там — нативная навигация по href; локальная смена нужна — режим local/hybrid')
        }
        return
      }
      if (locked()) return
      if (opts.onSwitch) await opts.onSwitch(stepKey)
      else host.set(stepKey)
    },
    get currentKey() {
      return segmentOf(full())
    },
    get fullKey() {
      return full()
    },
    set(stepKey: string) {
      if (mode === 'url') {
        if (findStep(stepKey)?.addressable === false) {
          if (locked()) return
          urlEphemeral = { base: sanitizeColdCurrent(opts.current()), value: stepKey }
          return
        }
        if (!urlModeWarned) {
          urlModeWarned = true
          warnOnce(
            `set() у «${opts.owner}» в режиме url не ведает состоянием: истину ведёт адрес — ` +
              'переходите ссылкой (items[].href) или меняйте адрес своим ключом брони. ' +
              'Локальная смена нужна — берите режим local (модалки) или hybrid (страницы).',
          )
        }
        return
      }
      if (locked()) return
      // гибрид: адресуемый шаг синхронизирует адрес своим ключом (полный ключ
      // цепочки целиком, если его первый сегмент объявлен и не помечен
      // `addressable: false`). Запись — общим писателем `#lib/address` (мелкая,
      // без навигации и load), а не своим `pushState`. Служебные состояния и
      // шаги с `addressable: false` адреса не получают.
      if (mode === 'hybrid' && BROWSER && host.isAddressable(stepKey)) {
        void writeAddress(() => ({ url: host.href(stepKey) }), { replace: false, load: false })
      }
      local = stepKey
    },
    href(stepKey: string) {
      // Видимый адрес, а не адрес последней отрисовки: после мелких записей (модалки,
      // панели, shallow-слои) адрес отрисовки описывает ПРОШЛОЕ состояние, и ссылка,
      // собранная из него, вернула бы старые ключи и потеряла новые.
      // Шаги с `addressable: false` собственный параметр шага в поиск не пишут.
      const here = visibleAddress().url
      const patchValue = findStep(stepKey)?.addressable === false ? null : stepKey
      return here.pathname + nextSearch(opts.owner, here.search, { [key]: patchValue })
    },
    arg(name: string, stepKey?: string) {
      const target = stepKey ?? segmentOf(full())
      if (!target) return undefined
      return readQuery(visibleAddress().url.search, `${key}.${target}.${name}`) as string | undefined
    },
    argHref(patch: Record<string, string | number | null>, stepKey?: string) {
      const target = stepKey ?? segmentOf(full())
      if (!target) throw new Error('argHref: текущий шаг не определён')
      const own: Record<string, string | number | null> = {}
      for (const [name, value] of Object.entries(patch)) own[`${key}.${target}.${name}`] = value
      const here = visibleAddress().url
      return here.pathname + nextSearch(opts.owner, here.search, own)
    },
    get items() {
      if (DEV) checkDup()
      const guardProps: Record<string, unknown> = { onclick: guard }
      return opts.steps().map((s) => {
        const current = this.currentKey === s.key
        const href = s.filled && s.addressable !== false ? this.href(s.key) : null
        return {
          key: s.key,
          label: s.label,
          href,
          current,
          locked: locked(),
          loading: href !== null ? linkTask(href).status === 'pending' : false,
          props: href !== null && locked() ? guardProps : {},
        }
      })
    },
  }
  return host
}
