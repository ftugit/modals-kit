<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    /**
     * ПОЧЕМУ поле недоступно (возможности источника), см. `Toggle`. Рядом с
     * подписью и в `title`, а при переданном `hintId` — ещё и с идентификатором.
     * На этот id ссылается `aria-describedby` контрола, когда причина пришла из
     * связки формы (`help`/`reason`); подсказку, которую знает только панель
     * (`jsOnly`, `hint` схемы), механизм не видит — она живёт текстом рядом и в
     * `title` (браузерный набор проверяет именно видимый текст).
     */
    hint?: string
    hintId?: string
    children?: Snippet
  }

  let { label, hint, hintId, children }: Props = $props()
</script>

<!-- Подсказка — тем же цветом, что подпись, отличается начертанием: /80 давал на карте
     контраст ниже 4.5:1 (axe color-contrast), пока подсказки были только у выключенных полей,
     это не проверялось. -->
<label class="flex flex-col gap-1.5" title={hint}>
  <span class="block text-xs font-medium text-muted-foreground">
    {label}{#if hint}<span class="ml-1 font-normal text-muted-foreground" data-field-hint id={hintId}>{hint}</span>{/if}
  </span>
  {#if children}
    {@render children()}
  {/if}
</label>
