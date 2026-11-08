<!--
  Нарезка UI фильтра. Оболочка не рисует рамку: `display: contents`, дети
  остаются клетками родительской сетки.

  Подпись не принимается. Имена контролов внутри сверяются с той же схемой,
  что у формы. Ровно один ключ — метка может забрать этот блок. Иначе блок
  остаётся в панели и всплывашки у меток нет.

  Открытая метка переносит этот же узел. Второй копии полей нет.
-->
<script lang="ts">
  import { DEV } from 'esm-env'
  import { untrack, type Snippet } from 'svelte'
  import { filterBlockCut } from './filter-block.js'
  import { useFilterBlocks } from './filter-blocks.svelte.js'

  let { children }: { children?: Snippet } = $props()

  const ctx = useFilterBlocks()

  let home = $state<HTMLElement | undefined>(undefined)
  let node = $state<HTMLElement | undefined>(undefined)
  let blockKey = $state<string | null>(null)
  let cutState = $state<'empty' | 'mixed' | 'ready'>('empty')
  let warned = false

  const open = $derived(Boolean(blockKey && ctx?.openKey === blockKey))

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

  function associate(root: HTMLElement, formId: string) {
    const stamped: HTMLElement[] = []
    const apply = () => {
      for (const el of root.querySelectorAll<HTMLElement>('input, select, textarea, button')) {
        if (el.hasAttribute('form')) continue
        el.setAttribute('form', formId)
        stamped.push(el)
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const el of stamped) {
        if (el.getAttribute('form') === formId) el.removeAttribute('form')
      }
    }
  }

  $effect(() => {
    const root = node
    const scheme = ctx?.schema
    const prefix = ctx?.prefix ?? ''
    if (!root || !ctx || !scheme) return
    const scan = () => {
      const cut = filterBlockCut(namesOf(root), scheme, prefix)
      untrack(() => {
        if (cut.key === null) {
          if (blockKey) ctx.release(blockKey, root)
          blockKey = null
          cutState = cut.reason
          if (DEV && cut.reason === 'mixed' && !warned) {
            warned = true
            console.warn('[filters] FilterBlock содержит больше одного ключа схемы — метка его не заберёт')
          }
          return
        }
        const homeEl = home
        if (!homeEl) return
        const claimed = ctx.claim({ key: cut.key, label: cut.label, element: root, home: homeEl })
        if (!claimed) {
          if (DEV && !warned) {
            warned = true
            console.warn(`[filters] ключ «${cut.key}» уже нарезан другим блоком`)
          }
          if (blockKey) ctx.release(blockKey, root)
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
        if (blockKey) ctx.release(blockKey, root)
      })
    }
  })

  $effect(() => {
    const root = node
    const homeEl = home
    const slot = ctx?.slot
    const mine = open
    if (!root || !homeEl || !mine || !slot) return
    const formId = ensureFormId(root)
    slot.appendChild(root)
    const stop = formId ? associate(root, formId) : undefined
    const field = root.querySelector<HTMLElement>('input, select, textarea')
    field?.focus({ preventScroll: true })
    return () => {
      stop?.()
      if (root.parentElement !== homeEl) homeEl.appendChild(root)
    }
  })
</script>

<span style="display: contents" data-filter-block-home bind:this={home}>
  <span
    style="display: contents"
    bind:this={node}
    data-filter-block={blockKey ?? undefined}
    data-filter-block-state={cutState}
  >
    {#if children}{@render children()}{/if}
  </span>
</span>
