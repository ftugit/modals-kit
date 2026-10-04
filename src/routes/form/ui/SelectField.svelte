<script lang="ts">
  import { inputVariants } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <select
    {...f.attrs}
    class={inputVariants({ class: 'pr-8' })}
    onblur={() => f.setTouched()}
    onchange={(e) => f.onInput(e.currentTarget.value)}
  >
    {#each f.options ?? [] as o (o.value)}
      <option value={o.value} selected={String(f.value ?? '') === o.value}>{o.label}</option>
    {/each}
  </select>
</FieldShell>
