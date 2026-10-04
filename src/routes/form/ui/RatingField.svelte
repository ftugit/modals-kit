<script lang="ts">
  // Компонент для СВОЕГО типа значения. Библиотека о нём не знает:
  // тип зарегистрирован приложением, компонент выбран через resolve.
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  const value = $derived(Number(f.value ?? 3))
</script>

<FieldShell {f}>
  <div class="flex items-center gap-3">
    <input
      {...f.attrs}
      class="flex-1 accent-primary"
      onchange={(e) => f.onInput(Number(e.currentTarget.value))}
      oninput={(e) => f.onInput(Number(e.currentTarget.value))}
    />
    <span class="w-16 text-sm text-muted-foreground">{'★'.repeat(Math.max(0, value))}</span>
  </div>
</FieldShell>
