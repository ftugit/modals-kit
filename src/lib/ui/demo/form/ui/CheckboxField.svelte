<script lang="ts">
  import { Checkbox, Label } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'

  let f: FieldView = $props()
</script>

<div class="space-y-1.5">
  <div class="flex items-center gap-2">
    <Checkbox
      {...f.attrs}
      onchange={(e) => { f.onInput(e.currentTarget.checked); f.setTouched() }}
    />
    <Label {...f.labelProps()}>{f.label}</Label>
  </div>
  {#if f.errors[0]}
    <p {...f.errorProps()} class="text-xs font-medium text-destructive">{f.errors[0].message}</p>
  {:else if f.has}
    <p class="text-xs text-destructive">ошибка без текста</p>
  {/if}
</div>
