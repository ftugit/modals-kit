<script lang="ts">
  // Переключатель темы (lemonade / night).
  import { Button } from '$lib/ui/primitives'
  import { onMount } from 'svelte'

  type Theme = 'lemonade' | 'night'
  let theme = $state<Theme>('lemonade')

  function apply(t: Theme) {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', t)
    document.documentElement.dataset.theme = t
  }

  onMount(() => {
    try {
      const stored = localStorage.getItem('fe-theme')
      const attr = document.documentElement.getAttribute('data-theme')
      const initial: Theme = stored === 'night' || attr === 'night' ? 'night' : 'lemonade'
      theme = initial
      apply(initial)
    } catch {
      /* ignore */
    }
  })

  function toggle() {
    const next: Theme = theme === 'night' ? 'lemonade' : 'night'
    theme = next
    apply(next)
    try {
      localStorage.setItem('fe-theme', next)
    } catch {
      /* ignore */
    }
  }
</script>

<Button variant="plain" size="none"
  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer ml-1"
  onclick={toggle}
  aria-label={theme === 'night' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
  title={theme === 'night' ? 'Светлая тема (lemonade)' : 'Тёмная тема (night)'}
>
  {#if theme === 'night'}
    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  {:else}
    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  {/if}
</Button>
