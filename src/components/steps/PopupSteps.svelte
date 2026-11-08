<!--
  Срезы ссылками. Не мастер `FormSteps` и не `Steps`: тот монтирует только
  текущий сниппет, этот держит все сниппеты в DOM.

  Метки — ссылки хоста (`stepLink`): без JS это переход на адрес шага, с JS
  в local/hybrid — локальная смена. Открытый срез — панель рядом с меткой,
  потомок этого компонента, не портал: если компонент внутри `<form>`, поля
  закрытых срезов остаются в форме и едут в POST (`hidden`, не `{#if}`).

  Закрыто, когда у хоста нет текущего ключа (`current: () => query ?? null`).
  Закрытие — ссылка `host.blankHref()`; в local/hybrid клик зовёт `host.close()`.

    <PopupSteps host={steps} label="Срезы">
      {#snippet main()}<Field of={bound.f.title} />{/snippet}
      {#snippet extra()}<Field of={bound.f.note} />{/snippet}
    </PopupSteps>
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { isModified } from '#hooks/links/state.svelte.js'
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
    host,
    label,
    separator = ', ',
    name = 'popup-steps',
    class: className = '',
    ...snippets
  }: Props & Record<string, unknown> = $props()

  const items = $derived(host.items)
  const openKey = $derived(host.currentKey)
  let root = $state<HTMLElement | undefined>()

  function panelId(key: string): string {
    return `${name}-${key}`
  }

  function closeClick(event: MouseEvent) {
    if (host.mode === 'url') return
    if (host.locked || event.defaultPrevented || isModified(event)) return
    event.preventDefault()
    host.close()
  }

  // Снаружи панели — только local/hybrid. В url клик мимо не перехватываем:
  // иначе он съест чужую ссылку страницы. Там закрытие — сама ссылка.
  $effect(() => {
    if (!openKey || host.mode === 'url') return
    const onPointer = (event: PointerEvent) => {
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return
      if (host.locked) return
      host.close()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  })
</script>

<div bind:this={root} class="inline {className}" role="group" aria-label={label} data-popup-steps="">
  {#each items as item, i (item.key)}
    {@const open = openKey === item.key}
    {@const snip = (snippets as Record<string, Snippet | undefined>)[item.key]}
    <span class="relative inline-block align-baseline">
      {#if item.href}
        <a
          {...stepLink(host, item.key)}
          class="font-medium underline-offset-4 hover:underline {item.locked ? 'pointer-events-none opacity-50' : ''}"
          aria-expanded={open}
          aria-controls={panelId(item.key)}
          aria-current={open ? 'true' : undefined}
        >{item.label}</a>
      {:else}
        <span class="text-muted-foreground" aria-current={open ? 'true' : undefined}>{item.label}</span>
      {/if}
      <!--
        Панель всегда в DOM. `hidden` прячет вид, не вырезает поля:
        закрытый срез всё равно участвует в отправке родительской формы.
      -->
      <div
        id={panelId(item.key)}
        hidden={!open}
        data-step={item.key}
        data-step-popup={open ? 'open' : 'closed'}
        class="absolute left-0 top-full z-20 mt-1 flex w-max max-w-sm min-w-56 flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-sm"
      >
        {#if snip}{@render snip()}{/if}
        <a
          href={host.blankHref()}
          class="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground {host.locked ? 'pointer-events-none opacity-50' : ''}"
          aria-disabled={host.locked ? 'true' : undefined}
          data-step-popup-close=""
          onclick={closeClick}
        >Закрыть</a>
      </div>
    </span>{#if i < items.length - 1}<span class="text-muted-foreground">{separator}</span>{/if}
  {/each}
</div>
