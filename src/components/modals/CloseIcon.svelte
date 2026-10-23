<script lang="ts">
  // Порт CloseIcon из src/components/icons.tsx оригинала (модальная зона).
  let { size = 20 }: { size?: number } = $props()
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.2"
  stroke-linecap="round"
  width={size}
  height={size}
  aria-hidden="true"
>
  <path d="M18 6 6 18M6 6l12 12" />
</svg>
