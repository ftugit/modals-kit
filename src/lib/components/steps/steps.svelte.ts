/**
 * Хост шагов — над бронью и алгеброй адреса (`#lib/address/keys`).
 *
 * Шаг — адресуемое состояние страницы (`?step=…`) с бронью своего ключа.
 * Компонент (`Steps.svelte`) рисует навигацию и логику конкретного шага;
 * хост решает, куда ведут ссылки, кто кликабелен и что происходит.
 *
 *  • **Чужое не теряется.** Адрес шага строится `nextSearch`: правится только
 *    свой ключ, остальные (`?modal=` цепочка, `?page.…` пагинатора) остаются.
 *  • **Аргументы шага** — как у модалок (`modal.1.pack`): своё семейство
 *    `step.<ключ>.<имя>`, чтение `arg`, правка `argHref`. Права те же: писать
 *    может только владелец брони.
 *  • **Замок полёта отправки** — состояние ЗАПИСИ истории (`page.state`),
 *    не адрес: шаг заперт — ссылка видима, но не кликабельна (`aria-disabled`,
 *    guard на щелчке). Замок пишет форма, хост только показывает.
 *  • **Переход в полёте** — `linkTask` писателя адреса: индикатор честный,
 *    без таймеров, только для перехода именно на этот шаг.
 */
import { page } from '$app/state'
import { claimQuery, nextSearch, readQuery } from '#lib/address/keys.js'
import { linkTask } from '#lib/address/sveltekit.js'

export type StepDef = {
  key: string
  label: string
  /** Шаг уже заполнен — ссылка; иначе текст, перейти на него нельзя. */
  filled?: boolean
}

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
  /** Ключ шага в адресе. По умолчанию `step`. */
  key?: string
  /** Определения шагов; `filled` считается страницей (она знает данные). */
  steps: () => readonly StepDef[]
  /** Ключ текущего шага (из данных загрузки или ответа экшена). */
  current: () => string | null
  /** Ключ замка полёта в `page.state`; нет — замок не показывается. */
  lockKey?: string
}

export type StepsHost = {
  /** Элементы навигации, в порядке определения. Реактивно. */
  readonly items: readonly StepItem[]
  /** Ключ текущего шага. */
  readonly currentKey: string | null
  /** Адрес шага (чужие ключи адреса не теряются). */
  href(stepKey: string): string
  /** Аргумент шага — чтение (`step.<ключ>.<имя>`); чужие права не нужны. */
  arg(name: string, stepKey?: string): string | undefined
  /** Аргумент шага — правка своим владельцем. */
  argHref(patch: Record<string, string | number | null>, stepKey?: string): string
}

export function useSteps(opts: StepsOptions): StepsHost {
  const key = opts.key ?? 'step'
  // бронь: сам ключ шага и семейство аргументов (`step.fill.id` накрывается `step.*`)
  claimQuery(opts.owner, key, `${key}.*`)

  const locked = () => (opts.lockKey ? page.state[opts.lockKey] === true : false)
  const guard = (e: Event) => {
    if (locked()) e.preventDefault()
  }

  const host: StepsHost = {
    get currentKey() {
      return opts.current()
    },
    href(stepKey: string) {
      return page.url.pathname + nextSearch(opts.owner, page.url.search, { [key]: stepKey })
    },
    arg(name: string, stepKey?: string) {
      const target = stepKey ?? opts.current()
      if (!target) return undefined
      return readQuery(page.url.search, `${key}.${target}.${name}`) as string | undefined
    },
    argHref(patch: Record<string, string | number | null>, stepKey?: string) {
      const target = stepKey ?? opts.current()
      if (!target) throw new Error('argHref: текущий шаг не определён')
      const own: Record<string, string | number | null> = {}
      for (const [name, value] of Object.entries(patch)) own[`${key}.${target}.${name}`] = value
      return page.url.pathname + nextSearch(opts.owner, page.url.search, own)
    },
    get items() {
      const guardProps: Record<string, unknown> = { onclick: guard }
      return opts.steps().map((s) => {
        const current = opts.current() === s.key
        const href = s.filled ? this.href(s.key) : null
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
