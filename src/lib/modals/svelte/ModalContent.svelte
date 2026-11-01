<script lang="ts">
  // Одна запись стопки. Не размонтируется, пока запись в цепочке.
  import { untrack, type Snippet } from 'svelte'
  import { loaderKey, runtimeKey, visibleChain } from '../core'
  import type { ResolvedEntry } from '../types'
  import { setInstance, useModals } from './context'
  import { resolvedModalComponent } from './component.svelte'
  import {
    MODAL_CONTENT_CLASS,
    MODAL_ERROR_CLASS,
    MODAL_REVEAL_CLASS,
    MODAL_SKELETON_CLASS,
  } from './classes'

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
  const chain = $derived(visibleChain(m.view.chain, m.claimEntry))

  // Данные актуальны для текущих параметров записи: сохраняются на экране и при
  // фоновом SWR тех же параметров, но не протекают при подмене параметров слота.
  const currentCk = $derived(loaderKey(entry.name, entry.params))
  const hasCurrentData = $derived(rt.data !== undefined && (!rt.ck || rt.ck === currentCk))

  const hasLoader = $derived(Boolean(entry.definition?.loader || entry.definition?.route))
  // Вид записи: ленивый компонент к моменту `ready` уже доехал (загрузчик
  // ждал его вместе с данными) — здесь только читаем разрешённый.
  const Component = $derived(
    entry.definition ? (resolvedModalComponent(entry.definition) as any) : undefined,
  )
  const compPending = $derived(Boolean(entry.definition?.component && !Component))
  let contentMounted = $state(false)
  // Во время CSS exit-анимации последней модалки (`m.view.chain.length === 0`)
  // уже отрисованный слой доигрывает уход без переключения обратно на скелетон,
  // хотя `runtime` в сторе уже синхронно очищен.
  const isExiting = $derived(m.view.chain.length === 0 && contentMounted)
  const showSkeleton = $derived(
    !isExiting &&
      rt.status !== 'error' &&
      (hasLoader
        ? !hasCurrentData && (rt.status === 'idle' || rt.status === 'loading')
        : compPending || rt.status === 'loading'),
  )

  // Показывали ли скелетон: только тогда содержимое стоит «раскрывать».
  let wasPending = $state(false)
  $effect(() => {
    if (showSkeleton) wasPending = true
    else if (entry.known && !(rt.status === 'error' && !hasCurrentData)) contentMounted = true
  })
  const transientContent = $derived(entry.definition ? null : m.modals.layerContent(entry.name))
  const transientSnippet = $derived(
    typeof transientContent === 'function' ? (transientContent as Snippet) : null,
  )
</script>

{#if !entry.known}
  {#if config.renderError}
    {@render (config.renderError as any)(`Нет такой модалки: «${entry.name}»`, 'Проверьте имя в реестре или ссылку с ?modal=…')}
  {:else}
    <div class={MODAL_ERROR_CLASS} data-modal-error="" role="alert">
      Нет такой модалки: «{entry.name}»
      <div>Проверьте имя в реестре или ссылку с ?modal=…</div>
    </div>
  {/if}
{:else if rt.status === 'error' && !hasCurrentData}
  {#if config.renderError}
    {@render (config.renderError as any)(rt.error ?? 'Приложение недоступно')}
  {:else}
    <div class={MODAL_ERROR_CLASS} data-modal-error="" role="alert">{rt.error ?? 'Приложение недоступно'}</div>
  {/if}
{:else if showSkeleton}
  {#if config.renderSkeleton}
    {@render (config.renderSkeleton as any)()}
  {:else}
    <div class={MODAL_SKELETON_CLASS} data-modal-skeleton="" aria-busy="true" aria-live="polite"></div>
  {/if}
{:else}
  <!-- после скелетона содержимое проявляется, а не возникает рывком -->
  <div
    class={wasPending ? `${MODAL_CONTENT_CLASS} ${MODAL_REVEAL_CLASS}` : MODAL_CONTENT_CLASS}
    data-modal-content=""
    data-modal-reveal={wasPending ? '' : undefined}
  >
    {#if Component}
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
