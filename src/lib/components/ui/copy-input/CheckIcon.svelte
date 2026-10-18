<script lang="ts">
  // Иконка «выполнено» (галка) для CopyInput: копирование удалось. В одном стиле
  // с остальными иконками-примитивами (`CopyIcon`, `WarningIcon`): stroke 2,
  // `currentColor`, `aria-hidden` — имя состояния объявляет кнопка через aria-label.
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
  <path d="M20 6 9 17l-5-5" />
</svg>
