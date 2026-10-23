<script lang="ts">
  // Объявление для скринридера: что происходит со списком. Тексты — UI, поэтому
  // здесь, а не в пагинаторе; ставится внутрь `PaginatorHost`.
  import { untrack } from 'svelte'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    loadingText?: string
    errorText?: (error: string) => string
    pageText?: (page: number) => string
  }

  let {
    name: nameProp,
    loadingText = 'Загрузка элементов...',
    errorText = (error) => `Ошибка: ${error}`,
    pageText = (page) => `Страница ${page}`,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">
  {pagState().status === 'loading'
    ? loadingText
    : pagState().error
      ? errorText(pagState().error ?? '')
      : pageText(pagState().page)}
</div>
