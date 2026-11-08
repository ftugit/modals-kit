<!--
  Срезы ссылками. Не мастер `FormSteps` и не `Steps`: тот монтирует только
  текущий сниппет, этот держит каждый сниппет одним экземпляром.

  Метки — ссылки хоста (`stepLink`). Открытый срез — не своя панель:
  `host.floating.openFlow` и `Portal` в `container(id)`, как у Select.
  На узком экране лист решает хост; своей опции «не быть листом» нет.
  Без хоста всплывашки нет: срез остаётся в потоке документа, не absolute.

  Портал вынимает поля из формы. Второй копии с тем же `name` нет.
  Пока контейнер хоста не готов, открытый сниппет лежит в форме (`hidden`
  только после гидратации, чтобы без JS его было видно). В контейнере
  контролы получают `form` предка — `FormData` и нативный POST их видят.

  Закрыто, когда у хоста нет текущего ключа. Закрытие — ссылка
  `blankHref()`; в local/hybrid клик зовёт `close()`. Escape, клик мимо
  и «Назад» закрывает хост модалок, не свой слушатель.

    <PopupSteps host={steps} label="Срезы">
      {#snippet main()}<Field of={bound.f.title} />{/snippet}
      {#snippet extra()}<Field of={bound.f.note} />{/snippet}
    </PopupSteps>
-->
<script lang="ts" module>
  let formSeq = 0
</script>

<script lang="ts">
  import { Portal } from '@ark-ui/svelte/portal'
  import { onMount, untrack, type Snippet } from 'svelte'
  import { BROWSER } from 'esm-env'
  import { writeAddress } from '#lib/address/sveltekit.js'
  import { cn } from '#components/utils.js'
  import { isModified } from '#hooks/links/state.svelte.js'
  import {
    tryUseModals,
    type HostFloatingCloseReason,
  } from '#lib/modals/svelte/index.js'
  import { stepLink } from './link.svelte.js'
  import type { StepsHost } from './steps.svelte.js'

  interface Props {
    host: StepsHost
    /** Подпись группы меток. */
    label: string
    /** Между метками. Запятая — вид по умолчанию, не единственный. */
    separator?: string
    /** Префикс id панелей, если на странице несколько групп. */
    name?: string
    class?: string
  }

  let {
    host: steps,
    label,
    separator = ', ',
    name = 'popup-steps',
    class: className = '',
    ...snippets
  }: Props & Record<string, unknown> = $props()

  const modals = tryUseModals()
  const items = $derived(steps.items)
  const openKey = $derived(steps.currentKey)

  let client = $state(false)
  let formId = $state<string | undefined>()
  let floatingId = $state<string | null>(null)
  let dismissedKey = $state<string | null>(null)
  let triggers = $state<Record<string, HTMLElement | undefined>>({})

  const popupNode = $derived(
    floatingId && modals ? modals.floating.container(floatingId) : undefined,
  )
  const portaled = $derived(Boolean(openKey && popupNode))
  // После гидратации прячем открытый срез в форме, пока он не уехал в хост.
  // До этого (SSR и без JS) он виден в потоке: иначе поля нельзя заполнить.
  const awaiting = $derived(client && Boolean(modals) && Boolean(openKey) && !popupNode)

  const hostedClass = cn(
    'flex max-h-full min-w-56 w-full flex-col overflow-auto rounded-lg border border-border bg-card text-sm text-card-foreground shadow-sm outline-none',
    'group-data-[layout=sheet]/sheet:h-full group-data-[layout=sheet]/sheet:min-w-0 group-data-[layout=sheet]/sheet:max-h-[var(--host-floating-max-height,85dvh)] group-data-[layout=sheet]/sheet:rounded-[16px] group-data-[layout=sheet]/sheet:shadow-[0_-10px_40px_-10px_color-mix(in_oklab,var(--foreground)_30%,transparent)]',
    'group-data-[layout=sheet]/sheet:pb-[max(12px,env(safe-area-inset-bottom))]',
    'group-data-[mobile-anchor=bottom]/sheet:rounded-b-none group-data-[mobile-anchor=bottom]/sheet:border-b-0',
    'group-data-[mobile-anchor=top]/sheet:rounded-t-none group-data-[mobile-anchor=top]/sheet:border-t-0',
    'group-data-[mobile-anchor=left]/sheet:rounded-l-none group-data-[mobile-anchor=left]/sheet:border-l-0',
    'group-data-[mobile-anchor=right]/sheet:rounded-r-none group-data-[mobile-anchor=right]/sheet:border-r-0',
  )

  function panelId(key: string): string {
    return `${name}-${key}`
  }

  function snippetOf(key: string): Snippet | undefined {
    return (snippets as Record<string, Snippet | undefined>)[key]
  }

  function rememberTrigger(key: string) {
    return (node: HTMLElement) => {
      triggers[key] = node
      return () => {
        if (triggers[key] === node) triggers[key] = undefined
      }
    }
  }

  function captureForm(node: HTMLElement) {
    const form = node.closest('form')
    if (!form) return
    if (!form.id) {
      formSeq += 1
      let id = `${name}-form-${formSeq}`
      while (document.getElementById(id)) {
        formSeq += 1
        id = `${name}-form-${formSeq}`
      }
      form.id = id
    }
    formId = form.id
  }

  /** Контрол вне формы участвует в POST, только если назван её id. */
  function associate(node: HTMLElement) {
    const id = formId
    if (!id) return
    const apply = () => {
      for (const el of node.querySelectorAll<HTMLElement>('input, select, textarea, button')) {
        if (!el.hasAttribute('form')) el.setAttribute('form', id)
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(node, { childList: true, subtree: true })
    const frame = requestAnimationFrame(apply)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }

  function focusSlice(node: HTMLElement) {
    const stop = associate(node)
    const field = node.querySelector<HTMLElement>('input, select, textarea')
    ;(field ?? node).focus({ preventScroll: true })
    return stop
  }

  function closeClick(event: MouseEvent) {
    if (steps.mode === 'url') return
    if (steps.locked || event.defaultPrevented || isModified(event)) return
    event.preventDefault()
    steps.close()
  }

  function floatingOptions(key: string) {
    const el = triggers[key]
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const item = items.find((entry) => entry.key === key)
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      triggers: [el],
      listWidth: 'auto' as const,
      minWidth: Math.max(rect.width, 280),
      maxWidth: 420,
      label: item?.label ?? label,
      placement: { gap: 6, minSideSpace: 160, maxOverlayHeight: 480 },
      onClose: (reason: HostFloatingCloseReason) => {
        floatingId = null
        if (reason === 'programmatic' || reason === 'transfer') return
        if (steps.locked) return
        dismissedKey = key
        if (steps.mode === 'url') {
          // close() в url не ведает состоянием. Адрес тот же, что у ссылки
          // «Закрыть», но без загрузки: иначе несохранённые поля срезов сгорят.
          if (BROWSER) {
            void writeAddress(() => ({ url: steps.blankHref() }), {
              replace: reason === 'history' || reason === 'owner-closed',
              load: false,
            })
          }
          return
        }
        steps.close()
      },
    }
  }

  function closeFloating() {
    const id = untrack(() => floatingId)
    if (!modals || id === null) return
    floatingId = null
    modals.floating.close(id)
  }

  onMount(() => {
    client = true
  })

  $effect(() => {
    const key = openKey
    if (!key) {
      dismissedKey = null
      closeFloating()
      return
    }
    if (!client || !modals || key === dismissedKey) return
    if (dismissedKey) dismissedKey = null
    const options = floatingOptions(key)
    if (!options) return
    const id = untrack(() => floatingId)
    if (id === null) floatingId = modals.floating.openFlow(options)
    else modals.floating.update(id, options)
  })

  $effect(() => {
    if (!portaled || !modals || floatingId === null || !openKey) return
    const id = floatingId
    const key = openKey
    const update = () => {
      const options = floatingOptions(key)
      if (options) modals.floating.update(id, options)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  $effect(() => () => {
    untrack(() => closeFloating())
  })
</script>

{#snippet closeLink()}
  <a
    href={steps.blankHref()}
    class="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground {steps.locked ? 'pointer-events-none opacity-50' : ''}"
    aria-disabled={steps.locked ? 'true' : undefined}
    data-step-popup-close=""
    onclick={closeClick}
  >Закрыть</a>
{/snippet}

<div
  class={cn('inline', className)}
  role="group"
  aria-label={label}
  data-popup-steps=""
  {@attach captureForm}
>
  {#each items as item, i (item.key)}
    {@const open = openKey === item.key}
    {#if item.href}
      <a
        {...stepLink(steps, item.key)}
        class="font-medium underline-offset-4 hover:underline {item.locked ? 'pointer-events-none opacity-50' : ''}"
        aria-expanded={open}
        aria-haspopup={portaled ? 'dialog' : undefined}
        aria-controls={open ? (popupNode?.id ?? panelId(item.key)) : undefined}
        aria-current={open ? 'true' : undefined}
        {@attach rememberTrigger(item.key)}
      >{item.label}</a>
    {:else}
      <span class="text-muted-foreground" aria-current={open ? 'true' : undefined}>{item.label}</span>
    {/if}{#if i < items.length - 1}<span class="text-muted-foreground">{separator}</span>{/if}
  {/each}

  {#each items as item (item.key)}
    {@const open = openKey === item.key}
    {@const snip = snippetOf(item.key)}
    {#if !(open && portaled)}
      <div
        id={panelId(item.key)}
        hidden={!open || awaiting}
        data-step={item.key}
        data-step-popup={open ? 'open' : 'closed'}
        class={open ? 'mt-2 flex flex-col gap-3 text-sm' : undefined}
      >
        {#if snip}{@render snip()}{/if}
        {#if open}
          {@render closeLink()}
        {/if}
      </div>
    {/if}
  {/each}
</div>

{#if portaled && openKey}
  {@const snip = snippetOf(openKey)}
  {@const item = items.find((entry) => entry.key === openKey)}
  <Portal container={popupNode}>
    <div data-step-popup-positioner="" class="static inset-auto h-auto w-full min-w-0">
      <div
        id={panelId(openKey)}
        data-step={openKey}
        data-step-popup="open"
        data-step-popup-host=""
        class={hostedClass}
        tabindex="-1"
        {@attach focusSlice}
      >
        <div
          class="hidden min-h-14 items-center justify-between gap-2 border-b border-border px-4 group-data-[layout=sheet]/sheet:flex"
          data-step-popup-head=""
        >
          <span class="text-[0.95rem] font-semibold">{item?.label ?? label}</span>
          {@render closeLink()}
        </div>
        <div class="flex flex-col gap-3 p-3">
          {#if snip}{@render snip()}{/if}
          <div class="group-data-[layout=sheet]/sheet:hidden">
            {@render closeLink()}
          </div>
        </div>
      </div>
    </div>
  </Portal>
{/if}
