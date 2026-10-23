<script lang="ts">
  // Иконка копирования в духе Android (два перекрывающихся прямоугольника —
  // как «content_copy» Material): копирование значения в буфер. Рисуется в
  // одном стиле с остальными иконками-примитивами (`CloseIcon`,
  // `WarningIcon`): stroke 2, `currentColor`, `aria-hidden` — имя действия
  // объявляет кнопка через `aria-label`.
  let { size = 20 }: { size?: number } = $props()
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  width={size}
  height={size}
  aria-hidden="true"
>
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
</svg>
