<script lang="ts">
  // Порт WarningIcon из src/components/icons.tsx оригинала (модальная зона).
  // Размер — инлайн-атрибутами: в оригинале Tailwind-классы size-*, но иконка
  // лежит вне зоны UnoCSS-токенов демо, и класс мог бы молча не примениться.
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
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</svg>
