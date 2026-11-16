<!--
  Нарезка UI фильтра. Оболочка не рисует рамку: `display: contents`, дети
  остаются клетками родительской сетки.

  Подпись не принимается. Имена контролов внутри сверяются со схемой каталога
  или с описанием формы списка. Ровно один ключ — метка может забрать этот
  блок. Иначе блок остаётся на месте и всплывашки у меток нет.

  Открытая метка переносит этот же узел. Второй копии полей нет.
-->
<script lang="ts">
  import { associatePortalControls } from '#hooks/form-portal.js'
  import { DEV } from 'esm-env'
  import { untrack, type Snippet } from 'svelte'
  import { resolveFilterBlockCut, type FilterBlockCut } from './filter-block.js'
  import { useFilterBlocks } from './filter-blocks.svelte.js'
  import {
    claimFilterList,
    filterLists,
    releaseFilterList,
    useFilterListName,
  } from './filter-registry.svelte.js'

  let { children }: { children?: Snippet } = $props()

  const panel = useFilterBlocks()
  const listName = useFilterListName()

  let home = $state<HTMLElement | undefined>(undefined)
  let node = $state<HTMLElement | undefined>(undefined)
  let blockKey = $state<string | null>(null)
  let cutState = $state<'empty' | 'mixed' | 'ready'>('empty')
  let warned = false

  const open = $derived.by(() => {
    if (!blockKey) return false
    if (panel) return panel.openKey === blockKey
    if (!listName) return false
    return filterLists[listName]?.openKey === blockKey
  })

  function namesOf(root: HTMLElement): string[] {
    const found: string[] = []
    if (root.getAttribute('name')) found.push(root.getAttribute('name') ?? '')
    for (const el of root.querySelectorAll<HTMLElement>('[name]')) {
      const name = el.getAttribute('name')
      if (name) found.push(name)
    }
    return found
  }

  function ensureFormId(root: HTMLElement): string | undefined {
    const form = root.closest('form')
    if (!form) return undefined
    if (!form.id) {
      let seq = 0
      let id = 'filter-block-form'
      while (document.getElementById(id)) {
        seq += 1
        id = `filter-block-form-${seq}`
      }
      form.id = id
    }
    return form.id
  }


  function cutOf(root: HTMLElement): FilterBlockCut {
    if (panel) return resolveFilterBlockCut(namesOf(root), { schema: panel.schema, prefix: panel.prefix })
    if (!listName) return { key: null, reason: 'empty' }
    const list = filterLists[listName]
    if (!list) return { key: null, reason: 'empty' }
    return resolveFilterBlockCut(namesOf(root), {
      schema: list.schema,
      prefix: list.prefix,
      labels: list.labels,
      aliases: list.aliases,
    })
  }

  function claim(entry: { key: string; label: string; element: HTMLElement; home: HTMLElement }): boolean {
    if (panel) return panel.claim(entry)
    if (!listName) return false
    return claimFilterList(listName, entry)
  }

  function release(key: string, element: HTMLElement) {
    if (panel) {
      panel.release(key, element)
      return
    }
    if (!listName) return
    releaseFilterList(listName, key, element)
  }

  /**
   * Высота блока в домашней раскладке. Сам `node` — `display: contents`, у него
   * нет бокса, поэтому меряем его детей: иначе placeholder схлопнется в 0 и
   * страница всё равно прыгнет.
   */
  function blockHeight(root: HTMLElement): number {
    const rects = [...root.children]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 || rect.height > 0)
    if (rects.length === 0) return Math.max(0, root.getBoundingClientRect().height)
    const top = Math.min(...rects.map((rect) => rect.top))
    const bottom = Math.max(...rects.map((rect) => rect.bottom))
    return Math.max(0, bottom - top)
  }

  function reserveHome(root: HTMLElement, homeEl: HTMLElement): HTMLFieldSetElement {
    const placeholder = document.createElement('fieldset')
    placeholder.setAttribute('data-filter-block-placeholder', '')
    placeholder.setAttribute('aria-hidden', 'true')
    placeholder.disabled = true
    // Оболочка — пустое место: никаких контролов, класса и style активного блока.
    placeholder.style.cssText = `display:block;width:100%;box-sizing:border-box;height:${blockHeight(root)}px;margin:0;padding:0;border:0;min-inline-size:0;pointer-events:none`
    homeEl.insertBefore(placeholder, root)
    return placeholder
  }

  $effect(() => {
    const root = node
    const list = listName ? filterLists[listName] : undefined
    const schema = panel?.schema ?? list?.schema
    const labels = list?.labels
    const aliases = list?.aliases
    if (!root || (!panel && !list)) return
    void schema
    void labels
    void aliases
    const scan = () => {
      const cut = cutOf(root)
      untrack(() => {
        if (cut.key === null) {
          if (blockKey) release(blockKey, root)
          blockKey = null
          cutState = cut.reason
          if (DEV && cut.reason === 'mixed' && !warned) {
            warned = true
            console.warn('[filters] FilterBlock содержит больше одного ключа — метка его не заберёт')
          }
          return
        }
        const homeEl = home
        if (!homeEl) return
        const claimed = claim({ key: cut.key, label: cut.label, element: root, home: homeEl })
        if (!claimed) {
          if (DEV && !warned) {
            warned = true
            console.warn(`[filters] ключ «${cut.key}» уже нарезан другим блоком`)
          }
          if (blockKey) release(blockKey, root)
          blockKey = null
          cutState = 'mixed'
          return
        }
        blockKey = cut.key
        cutState = 'ready'
      })
    }
    scan()
    const observer = new MutationObserver(scan)
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['name'] })
    return () => {
      observer.disconnect()
      untrack(() => {
        if (blockKey) release(blockKey, root)
      })
    }
  })

  $effect(() => {
    const root = node
    const homeEl = home
    const slot = panel ? panel.slot : listName ? (filterLists[listName]?.slot ?? null) : null
    const mine = open
    if (!root || !homeEl || !mine || !slot) return
    const formId = ensureFormId(root)
    // Перенос узла не должен менять высоту дома: иначе scroll anchoring
    // уменьшает scrollTop, а CollapsingHeader читает это как жест «вверх».
    const placeholder = reserveHome(root, homeEl)
    slot.appendChild(root)
    const stop = formId ? associatePortalControls(root, formId, { cleanup: true }) : undefined
    const field = root.querySelector<HTMLElement>('input, select, textarea')
    field?.focus({ preventScroll: true })
    return () => {
      stop?.()
      if (root.parentElement !== homeEl) homeEl.insertBefore(root, placeholder)
      placeholder.remove()
    }
  })
</script>

<div style="display: contents" data-filter-block-home bind:this={home}>
  <span
    style="display: contents"
    bind:this={node}
    data-filter-block={blockKey ?? undefined}
    data-filter-block-state={cutState}
  >
    {#if children}{@render children()}{/if}
  </span>
</div>
