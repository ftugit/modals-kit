<script lang="ts">
  /**
   * Сводка показанного — только на состоянии пагинатора.
   *
   * Компонент рендерится ВНУТРИ `PaginatorHost`, поэтому состояние берётся из
   * области видимости (`usePaginatorState()` без имени): на SSR это снимок
   * лоадера, на клиенте — живой стор. Счётчик с страницы (`data.snapshot`) тут
   * не при чём: после отправки формы страница не перезагружается, и серверные
   * цифры остались бы вчерашними.
   */
  import { usePaginatorState } from '$lib/paginate/svelte'
  import { dbListExtraOf, type DbPost } from './definition'
  interface Props {
    /** Показывать первую строку как она пришла из слоя (технический блок). */
    showRaw?: boolean
  }

  let { showRaw = false }: Props = $props()

  const state = usePaginatorState<DbPost>()
  const page = $derived(state().page)
  const rows = $derived(state().pages?.[page] ?? [])
  const cfg = $derived(dbListExtraOf(state().extra))
  const raw = $derived(rows.length > 0 ? JSON.stringify(rows[0]) : '—')
</script>

<p class="text-sm text-muted-foreground" data-testid="list-meta">
  всего записей: <strong data-testid="total">{state().totalItems ?? '—'}</strong>, размер
  страницы: {state().pageSize}, страницы: {page}
  {#if rows.length}
    ({rows.length} строк здесь{cfg.mode === 'stream' ? ', в потоке — с накоплением' : ''})
  {/if}
  · режим: <b data-testid="list-mode">{cfg.mode === 'stream' ? 'поток' : 'страницы'}</b>
</p>

{#if showRaw}
  <pre class="overflow-auto rounded-lg bg-muted p-3 text-xs" data-testid="raw">{raw}</pre>
{/if}
