<script lang="ts">
  /**
   * Кнопки формы фильтров: «Сбросить» и «Применить» (отправка формы). Ставится внутрь
   * `<Form>` компонента фильтров там, где их видит приложение.
   *
   * «Сбросить» — как `PageLink`: есть ссылка от адаптера — рисуется ссылка (работает
   * без JS, чужие ключи адреса живут), обычный клик с JS уходит в `onReset`; ссылки
   * нет (хранилище без адреса) — кнопка `onReset`.
   */
  import { asLink } from '#lib/components/links/index.js'
  import { Button } from '#lib/components/ui/index.js'

  let {
    resetHref,
    onReset,
    class: cls = '',
  }: { resetHref?: string; onReset?: () => void; class?: string } = $props()

  function click(event: MouseEvent) {
    // Модификаторы и не-левая кнопка — это браузер: новая вкладка, копирование адреса.
    if (!onReset || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onReset()
  }
</script>

<div class={`flex flex-wrap items-center justify-end gap-2 ${cls}`}>
  {#if resetHref}
    <Button {...asLink(resetHref)} onclick={click} variant="outline" size="sm" data-testid="catalog-filter-reset">Сбросить</Button>
  {:else if onReset}
    <Button type="button" onclick={onReset} variant="outline" size="sm" data-testid="catalog-filter-reset">Сбросить</Button>
  {/if}
  <Button type="submit" size="sm" data-testid="catalog-filter-submit">Применить</Button>
</div>
