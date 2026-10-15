<script lang="ts">
  // Полоска сверху окна. Ставится один раз в корневой layout; без JS не
  // рисуется (без JS загрузку показывает сам браузер).
  import { loaderView, TASK_DELAY_MS } from './loader.svelte.js'

  const view = $derived(loaderView())
  const local = $derived(view.active && !view.global)

  // Задержка только для local; таймер зависит от «идёт / не идёт», не от хода.
  let late = $state(false)
  $effect(() => {
    if (!local) {
      late = false
      return
    }
    const timer = setTimeout(() => (late = true), TASK_DELAY_MS)
    return () => clearTimeout(timer)
  })
  const shown = $derived(view.global || (local && late))
</script>

{#if shown}
  <div
    role="progressbar"
    aria-label={view.label ?? 'Загрузка'}
    aria-valuemin={view.percent === null ? undefined : 0}
    aria-valuemax={view.percent === null ? undefined : 100}
    aria-valuenow={view.percent ?? undefined}
    data-testid="loader-bar"
    class="pointer-events-none fixed inset-x-0 top-0 h-0.5 overflow-hidden"
    style="z-index: 2147483647"
  >
    {#if view.percent === null}
      <div class="loader-run h-full w-1/3 bg-primary"></div>
    {:else}
      <div class="h-full bg-primary transition-[width] duration-200" style:width="{view.percent}%"></div>
    {/if}
  </div>
{/if}

<style>
  .loader-run {
    animation: loader-run 1.1s ease-in-out infinite;
  }
  @keyframes loader-run {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loader-run {
      animation-duration: 3s;
    }
  }
</style>
