<script lang="ts">
  // Переключатель (примитив Switch): тот же флажок, роль switch — в attrs типа.
  import { Label, Switch } from '#lib/ui/primitives/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'

  let f: FieldView = $props()
</script>

<div class="space-y-1.5">
  <div class="flex items-center gap-2">
    <Switch
      {...f.attrs}
      onchange={(e) => { f.onInput(e.currentTarget.checked); f.setTouched() }}
    />
    <Label {...f.labelProps()}>{f.label}</Label>
  </div>
  {#if f.help || f.reason}
    <p {...f.helpProps()} class="text-xs text-muted-foreground"
       data-field-reason={f.reason ? '' : undefined}>{f.reason ?? f.help}</p>
  {/if}
  {#if f.errors[0]}
    <p {...f.errorProps()} class="text-xs font-medium text-destructive">{f.errors[0].message}</p>
  {:else if f.has}
    <p class="text-xs text-destructive">ошибка без текста</p>
  {/if}
</div>
