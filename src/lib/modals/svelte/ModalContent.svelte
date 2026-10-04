<script lang="ts">
  // Одна запись стопки. Не размонтируется, пока запись в цепочке.
  import { untrack, type Snippet } from 'svelte'
  import { runtimeKey, visibleChain } from '../core'
  import type { ResolvedEntry } from '../types'
  import { setInstance, useModals } from './context'

  interface Props {
    entry: ResolvedEntry
    active: boolean
  }
  let { entry, active }: Props = $props()

  const m = useModals()

  const initial = untrack(() => ({ name: entry.name, index: entry.index }))
  setInstance(initial)

  const key = runtimeKey(initial.name, initial.index)
  const rt = $derived(m.view.runtime[key] ?? { status: 'idle' as const })
  const config = $derived(m.view.hostConfig)

  // Содержимому отдаём видимую цепочку: headless-записи нет ни на экране,
  // ни в глубине, которую видит пользователь (ISSUES.md R-02).
  const chain = $derived(visibleChain(m.view.chain))

  // Показывали ли скелетон: только тогда содержимое стоит «раскрывать».
  let wasPending = $state(false)
  $effect(() => {
    if (rt.status === 'loading') wasPending = true
  })

  const hasLoader = $derived(Boolean(entry.definition?.loader || entry.definition?.route))
  const showSkeleton = $derived(hasLoader && rt.status !== 'ready' && rt.status !== 'error')
  const transientContent = $derived(entry.definition ? null : m.modals.layerContent(entry.name))
  const transientSnippet = $derived(
    typeof transientContent === 'function' ? (transientContent as Snippet) : null,
  )
</script>

{#if !entry.known}
  {#if config.renderError}
    {@render (config.renderError as any)(`Нет такой модалки: «${entry.name}»`, 'Проверьте имя в реестре или ссылку с ?modal=…')}
  {:else}
    <div class="modal-error" role="alert">
      Нет такой модалки: «{entry.name}»
      <div>Проверьте имя в реестре или ссылку с ?modal=…</div>
    </div>
  {/if}
{:else if rt.status === 'error'}
  {#if config.renderError}
    {@render (config.renderError as any)(rt.error ?? 'Ошибка загрузки')}
  {:else}
    <div class="modal-error" role="alert">{rt.error ?? 'Ошибка загрузки'}</div>
  {/if}
{:else if showSkeleton}
  {#if config.renderSkeleton}
    {@render (config.renderSkeleton as any)()}
  {:else}
    <div class="modal-skeleton" aria-busy="true" aria-live="polite"></div>
  {/if}
{:else}
  <!-- после скелетона содержимое проявляется, а не возникает рывком -->
  <div class="modal-content" class:modal-reveal={wasPending}>
    {#if entry.definition?.component}
      {@const Component = entry.definition.component as any}
      <Component
        name={entry.name}
        index={entry.index}
        depth={chain.length}
        params={entry.params}
        {chain}
        data={m.view.sharedData}
        {active}
      />
    {:else if transientSnippet}
      {@render transientSnippet()}
    {/if}
  </div>
{/if}
