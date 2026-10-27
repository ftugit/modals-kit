<script lang="ts">
  // Объявление для скринридера: что происходит со списком. Тексты — UI, поэтому
  // здесь, а не в пагинаторе; ставится внутрь `PaginatorHost`.
  import { untrack } from 'svelte'
  import { cn } from '#components/utils.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    loadingText?: string
    errorText?: (error: string) => string
    pageText?: (page: number) => string
    /** Классы корневого элемента (через `cn` к базовым, как у `Acl`). */
    class?: string
  }

  let {
    name: nameProp,
    loadingText = 'Загрузка элементов...',
    errorText = (error) => `Ошибка: ${error}`,
    pageText = (page) => `Страница ${page}`,
    class: className,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
</script>

<div class={cn('sr-only', className)} aria-live="polite" aria-atomic="true">
  {pagState().status === 'loading'
    ? loadingText
    : pagState().error
      ? errorText(pagState().error ?? '')
      : pageText(pagState().page)}
</div>
