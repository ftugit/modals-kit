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
  import { DB_LIST_ORDER_DEFAULT, dbListExtraOf, type DbPost } from './definition'
  interface Props {
    /** Показывать первую строку как она пришла из слоя (технический блок). */
    showRaw?: boolean
  }

  let { showRaw = false }: Props = $props()

  const state = usePaginatorState<DbPost>()
  const page = $derived(state().page)
  const rows = $derived(state().pages?.[page] ?? [])
  const cfg = $derived(dbListExtraOf(state().extra))
  const shown = $derived(
    Object.keys(state().pages ?? {})
      .map(Number)
      .sort((a, b) => a - b)
      .reduce((acc, n) => acc + (state().pages[n]?.length ?? 0), 0),
  )
  const raw = $derived(rows.length > 0 ? JSON.stringify(rows[0]) : '—')
</script>

<p class="text-sm text-muted-foreground" data-testid="list-meta">
  всего записей: <strong data-testid="total">{state().totalItems ?? '—'}</strong>, размер
  страницы: {state().pageSize}, страницы: {page}
  {#if rows.length}({rows.length} строк здесь){/if}
  · режим: <b data-testid="list-mode">{cfg.cur ? 'курсор' : 'страницы'}</b>
  · указатель:
  <b data-testid="list-pointer">{cfg.after ? 'в адресе (?page.after)' : '—'}</b>
  · сортировка: <b data-testid="list-order">{cfg.ord === DB_LIST_ORDER_DEFAULT ? 'по умолчанию' : cfg.ord}</b>
  {#if cfg.cur}
    · в окне сейчас: <b data-testid="list-window">{shown}</b> строк на {Object.keys(state().pages ?? {}).length}
    страниц{#if state().hasNext === false} · поток на этом кончается{/if}
  {/if}
</p>

{#if showRaw}
  <pre class="overflow-auto rounded-lg bg-muted p-3 text-xs" data-testid="raw">{raw}</pre>
{/if}
