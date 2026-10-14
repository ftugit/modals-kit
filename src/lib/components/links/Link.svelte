<script lang="ts" module>
  /**
   * Задержка показа индикатора: переход, который уложился в неё, не мигает.
   * «Мелкие» записи адреса (модалки, пагинатор) держат `navigating` 1–2 мс
   * (замер хода 129) и сюда не доходят вовсе.
   */
  export const LINK_TASK_DELAY_MS = 150

  /** Последний сегмент пути похож на файл: `/robots.txt`, `/files/report.pdf`. */
  const FILE_PATH = /\/[^/]+\.[a-z0-9]{1,8}$/i
</script>

<script lang="ts">
  /**
   * Ссылка приложения. Под капотом — ОБЫЧНАЯ `<a href>`: без JavaScript это
   * просто ссылка, браузер переходит сам.
   *
   * Что делает сама (бывший `LoadLink` + индикатор задачи):
   *
   *  - **Битая ссылка блокируется** — как у триггера модалки: адреса нет в
   *    таблице роутов приложения → у ссылки нет `href` (не кликается ни с JS,
   *    ни без), `aria-disabled`, `data-state="error"`, знак «!» и подсказка
   *    «Страницы /x не существует». Видно уже в SSR-разметке. Проверку делает
   *    ядро модалок (`routeResolves`, решение №30), ссылка только спрашивает.
   *    Не проверяются: чужой сайт, файлы (`/robots.txt`), `download`,
   *    `rel="external"`, `data-sveltekit-reload` — так помечают и ссылку на
   *    эндпоинт `+server.ts`.
   *  - **Индикатор перехода**: переход SvelteKit на её адрес (`linkTask`) —
   *    через 150 мс спиннер перед текстом, `aria-busy`, `data-state="loading"`.
   *  - **`navigateOnError={false}`** — загрузчик упал, пользователь остаётся на
   *    месте, ошибка на ссылке («!» и текст в подсказке); повторный клик —
   *    новая попытка. Для этого ссылка сама прогоняет загрузчик
   *    (`preloadData`), а потом переходит. Без опции клик ведёт SvelteKit:
   *    он и так не показывает страницу, пока не отработал `load`, а ошибку
   *    показывает страницей `+error`.
   *  - **`replace`** — заменить запись истории (`data-sveltekit-replacestate`).
   *  - **`task`** — состояние от библиотеки, которая ведёт ссылку сама
   *    (`#lib/task`); проценты, если есть, видны рядом со спиннером.
   *
   * Атрибуты потребителя расходятся ДО своих (правило примитивов). Свой
   * `onclick` потребителя вызывается первым; `preventDefault` в нём —
   * «ссылку обработал я» (так открывают модалку по `?modal=…`).
   */
  import type { Snippet } from 'svelte'
  import type { HTMLAnchorAttributes } from 'svelte/elements'
  import { goto } from '$app/navigation'
  import { routeResolves } from '#lib/modals/cores/sveltekit.js'
  import { linkTask, preloadOutcome, resolveHref, visibleHref } from '#lib/router/sveltekit.js'
  import type { TaskState } from '#lib/task/index.js'
  import TaskIndicator from '#lib/ui/primitives/TaskIndicator.svelte'

  interface Props extends HTMLAnchorAttributes {
    /** Состояние от библиотеки, которая ведёт эту ссылку сама; нет — переход SvelteKit. */
    task?: TaskState
    /** Заменить запись истории вместо добавления. */
    replace?: boolean
    /**
     * `false` — при ошибке загрузчика (и при отказе самой предзагрузки: сеть,
     * чанк) остаться на месте и показать ошибку на ссылке. По умолчанию —
     * переход, страницу ошибки покажет `+error`.
     */
    navigateOnError?: boolean
    children?: Snippet
  }

  let {
    href,
    task,
    replace = false,
    navigateOnError = true,
    title,
    onclick,
    children,
    ...rest
  }: Props = $props()

  const target = $derived(resolveHref(href))

  /** Адрес этого приложения, которого нет среди его страниц. */
  const missing = $derived.by(() => {
    if (!target?.local) return null
    if (rest.download != null || rest['data-sveltekit-reload'] != null) return null
    if (/(^|\s)external(\s|$)/.test(String(rest.rel ?? ''))) return null
    const path = target.url.pathname
    if (FILE_PATH.test(path) || routeResolves(path)) return null
    return path
  })

  // Своя предзагрузка — только в режиме `navigateOnError={false}`.
  let status = $state<'idle' | 'loading' | 'error'>('idle')
  let failure = $state('')

  const current = $derived<TaskState>(
    missing !== null
      ? { status: 'error', message: `Страницы ${missing} не существует` }
      : status === 'error'
        ? { status: 'error', message: failure }
        : status === 'loading'
          ? { status: 'pending', scope: 'local', label: 'Загрузка страницы' }
          : (task ?? linkTask(href)),
  )
  const pending = $derived(current.status === 'pending')

  // Таймер зависит только от «идёт / не идёт»: ход задачи (проценты) его не
  // перезапускает.
  let shown = $state(false)
  $effect(() => {
    if (!pending) {
      shown = false
      return
    }
    const timer = setTimeout(() => (shown = true), LINK_TASK_DELAY_MS)
    return () => clearTimeout(timer)
  })

  const visual = $derived(current.status === 'error' ? 'error' : shown ? 'loading' : undefined)

  // Ушли со страницы, пока шла своя предзагрузка, — переход отменён (как F29
  // у триггера модалки).
  let alive = true
  $effect(() => () => {
    alive = false
  })

  /** Модификаторы и средняя кнопка — отдаём браузеру, как обычной ссылке. */
  const isModified = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

  function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLAnchorElement }) {
    if (missing !== null) {
      event.preventDefault()
      return
    }
    onclick?.(event)
    if (event.defaultPrevented || navigateOnError || !href || isModified(event)) return
    event.preventDefault()
    if (status !== 'loading') void loadThenGo(href)
  }

  async function loadThenGo(to: string) {
    status = 'loading'
    failure = ''
    const start = visibleHref()
    const outcome = await preloadOutcome(to)
    if (!alive || visibleHref() !== start) {
      status = 'idle'
      return
    }
    // Переадресация — штатный исход, не ошибка: переходим по исходному адресу,
    // SvelteKit сам её выполнит (в том числе на внешний адрес).
    if (outcome.kind === 'error') {
      failure = outcome.status
        ? `ошибка ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`
        : `не удалось загрузить страницу${outcome.message ? `: ${outcome.message}` : ''}`
      status = 'error'
      return
    }
    status = 'idle'
    goto(to, { replace }).catch((error: unknown) => {
      failure = `не удалось перейти${error instanceof Error && error.message ? `: ${error.message}` : ''}`
      status = 'error'
    })
  }
</script>

<a
  {...rest}
  href={missing !== null ? undefined : href}
  role={missing !== null ? 'link' : rest.role}
  title={current.status === 'error' ? current.message : title}
  aria-disabled={missing !== null ? true : rest['aria-disabled']}
  aria-busy={shown ? true : rest['aria-busy']}
  data-state={visual ?? rest['data-state']}
  data-sveltekit-replacestate={replace ? '' : rest['data-sveltekit-replacestate']}
  onclick={handleClick}
>
  <!-- Индикатор перед текстом — как у триггера модалки («⚠ Несуществующая»). -->
  {#if visual}<TaskIndicator task={current} class="me-1" />{/if}{@render children?.()}
</a>
