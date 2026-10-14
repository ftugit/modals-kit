<script lang="ts">
  /**
   * Кнопки формы фильтров: «Сбросить» — настоящая ссылка (работает без JS,
   * чужие ключи адреса живут), «Применить» — отправка формы. Ставится внутрь
   * `<Form>` компонента фильтров там, где их видит приложение.
   */
  import { asLink } from '#lib/components/links/index.js'
  import { Button } from '#lib/components/ui/index.js'

  let { resetHref, class: cls = '' }: { resetHref?: string; class?: string } = $props()
</script>

<div class={`flex flex-wrap items-center justify-end gap-2 ${cls}`}>
  {#if resetHref}
    <Button {...asLink(resetHref)} variant="outline" size="sm" data-testid="catalog-filter-reset">Сбросить</Button>
  {/if}
  <Button type="submit" size="sm" data-testid="catalog-filter-submit">Применить</Button>
</div>
