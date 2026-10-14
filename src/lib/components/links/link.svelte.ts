// `asLink` — сделать элемент ссылкой приложения. Вид даёт сам элемент:
//
//   <a {...asLink('/paginator')}>Пагинатор</a>
//   <Button {...asLink('/form')} variant="outline">Формы</Button>
//
// Без JavaScript это обычная `<a href>`. С JavaScript добавляется:
//  - битая ссылка (адреса нет среди страниц) — без `href`, `aria-disabled`,
//    знак «!» и причина в `title`; видно уже в SSR-разметке;
//  - спиннер перед текстом, пока SvelteKit переходит именно на её адрес;
//  - `navigateOnError: false` — загрузчик упал, остаёмся на месте с ошибкой.
import { goto } from '$app/navigation'
import { createAttachmentKey } from 'svelte/attachments'
import { routeResolves } from '#lib/modals/cores/sveltekit.js'
import { linkTask, preloadOutcome, resolveHref, visibleHref } from '#lib/router/sveltekit.js'
import type { TaskState } from '#lib/task/index.js'
import { blockClicks, defined, isModified, reflectTask, type LinkAttrs } from './state.svelte.js'

export interface LinkOptions {
  /**
   * `false` — при ошибке загрузчика (и при отказе самой предзагрузки: сеть,
   * чанк) остаться на месте и показать ошибку на ссылке; повторный клик —
   * новая попытка. Для этого ссылка сама прогоняет загрузчик, потом переходит.
   * По умолчанию переход ведёт SvelteKit, ошибку покажет `+error`.
   */
  navigateOnError?: boolean
  /** Заменить запись истории вместо добавления (`data-sveltekit-replacestate`). */
  replace?: boolean
  /**
   * `false` — не сверять адрес со страницами приложения: ссылка на эндпоинт
   * `+server.ts` или на файл без расширения. Чужой сайт и адреса с
   * расширением (`/robots.txt`) не сверяются и так.
   */
  check?: boolean
  /** Состояние от библиотеки, которая ведёт ссылку сама (`#lib/task`); нет — переход SvelteKit. */
  task?: () => TaskState
}

/** Последний сегмент пути похож на файл: `/robots.txt`, `/files/report.pdf`. */
const FILE_PATH = /\/[^/]+\.[a-z0-9]{1,8}$/i
const LINK = createAttachmentKey()

type OwnState = { status: 'idle' | 'loading' | 'error'; failure: string }
/** Своя предзагрузка живёт на элементе: атрибуты пересчитываются на каждой навигации, элемент — тот же. */
const own = new WeakMap<Element, OwnState>()
const ownOf = (el: Element): OwnState => {
  const found = own.get(el)
  if (found) return found
  const st: OwnState = $state({ status: 'idle', failure: '' })
  own.set(el, st)
  return st
}

/** Путь этого приложения, которого нет среди его страниц, — или `null`. */
function missingPath(href: string | null | undefined, check: boolean): string | null {
  const target = resolveHref(href)
  if (!check || !target?.local) return null
  const path = target.url.pathname
  return FILE_PATH.test(path) || routeResolves(path) ? null : path
}

export function asLink(href: string | null | undefined, options: LinkOptions = {}): LinkAttrs {
  const missing = missingPath(href, options.check !== false)

  if (missing !== null) {
    return {
      ...defined({
        role: 'link',
        title: `Страницы ${missing} не существует`,
        'aria-disabled': 'true',
        'data-state': 'error',
        'data-link': '',
      }),
      // `null`, а не отсутствие: `Button` по ключу `href` рисует `<a>`.
      href: null,
      [LINK]: blockClicks,
    }
  }

  return {
    ...defined({
      href: href ?? undefined,
      'data-link': '',
      'data-sveltekit-replacestate': options.replace ? '' : undefined,
    }),
    [LINK]: (el: HTMLElement) => {
      const st = ownOf(el)
      const onClick = (e: MouseEvent) => {
        if (options.navigateOnError !== false || !href || e.defaultPrevented || isModified(e)) return
        e.preventDefault()
        if (st.status !== 'loading') void loadThenGo(el, st, href, options.replace ?? false)
      }
      el.addEventListener('click', onClick)
      reflectTask(el, () =>
        st.status === 'error'
          ? { status: 'error', message: st.failure }
          : st.status === 'loading'
            ? { status: 'pending', scope: 'local', label: 'Загрузка страницы' }
            : (options.task?.() ?? linkTask(href)),
      )
      return () => el.removeEventListener('click', onClick)
    },
  }
}

async function loadThenGo(el: Element, st: OwnState, to: string, replace: boolean): Promise<void> {
  st.status = 'loading'
  st.failure = ''
  const start = visibleHref()
  const outcome = await preloadOutcome(to)
  // Ушли со страницы, пока шла предзагрузка, — переход отменён (как F29 у модалок).
  if (!el.isConnected || visibleHref() !== start) {
    st.status = 'idle'
    return
  }
  // Переадресация — штатный исход: переходим по исходному адресу, SvelteKit сам её выполнит.
  if (outcome.kind === 'error') {
    st.failure = outcome.status
      ? `ошибка ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`
      : `не удалось загрузить страницу${outcome.message ? `: ${outcome.message}` : ''}`
    st.status = 'error'
    return
  }
  st.status = 'idle'
  goto(to, { replace }).catch((error: unknown) => {
    st.failure = `не удалось перейти${error instanceof Error && error.message ? `: ${error.message}` : ''}`
    st.status = 'error'
  })
}
