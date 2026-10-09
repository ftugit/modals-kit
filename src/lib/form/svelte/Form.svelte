<script lang="ts">
  /**
   * Форма-обёртка: ЕДИНСТВЕННОЕ место, где потребитель имеет право на тег <form>.
   *
   * Раньше каждый потребитель разворачивал свою конструкцию
   * `<form {...form.formProps()}>` + скрытые поля вручную — и каждый делал
   * это чуть иначе: кто-то терял hidden-пары (GET без JS стирал чужие ключи
   * адреса), кто-то ставил onsubmit после spread и терял commitUrl. Здесь
   * инвариант держит библиотека: formProps первым, поверх — атрибуты
   * потребителя, скрытые поля — внутри формы всегда.
   *
   * Нативные теги полей внутри — осознанно: это сам слой lib/form,
   * примитивы UI ему знать не должен (гард layer-guard это и проверяет).
   */
  import type { HTMLFormAttributes } from 'svelte/elements'
  import type { Snippet } from 'svelte'
  import type { FormProps } from './bind.svelte'

  interface Props extends Omit<HTMLFormAttributes, 'children'> {
    /** Достаточно formProps() — BoundForm или его structural-подобная часть. */
    form: { formProps(): FormProps }
    /**
     * Скрытые поля: пары, которые потребитель сохраняет в адресе (чужие
     * ключи, указатель страницы). Массив — не генератор: реактивность
     * держит вызывающая сторона ($derived). Имя не `hidden` — то занято
     * нативным булевым атрибутом.
     */
    hiddenFields?: readonly { name: string; value: unknown }[]
    children?: Snippet
  }

  let { form, hiddenFields = [], children, ...rest }: Props = $props()

  // formProps первым: атрибуты потребителя перекрывают (onsubmit у
  // поиска именно перекрывает). Символьный ключ ATTACH из formProps при
  // слиянии расширяет индекс — DOM-пропсы Svelte его не любят, поэтому
  // единый объект собираем здесь и приводим к форм-атрибутам.
  const attrs = $derived(
    Object.assign({}, form.formProps(), rest) as unknown as HTMLFormAttributes,
  )
</script>

<form {...attrs}>
  {#each hiddenFields as h (h.name + '=' + String(h.value))}
    <input type="hidden" name={h.name} value={h.value} />
  {/each}
  {@render children?.()}
</form>
