<script lang="ts">
  // Иконка закрытия / очистки в одном стиле с `CopyIcon`, `CheckIcon` и
  // `WarningIcon`: `stroke-width="2"`, `currentColor`, `aria-hidden` — доступное
  // имя действия объявляет родительская кнопка через `aria-label`.
  let { size = 16 }: { size?: number } = $props()
</script>

<svg
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  width={size}
  height={size}
  aria-hidden="true"
>
  <path d="m4 4 8 8m0-8-8 8" />
</svg>
