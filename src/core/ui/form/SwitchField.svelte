<script lang="ts">
  // Переключатель (примитив Switch): тот же флажок, роль switch — в attrs типа.
  import { Switch } from '#core/ui/index.js'
  import type { FieldView } from '#core/lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f} labelPlacement="end">
  <Switch
    {...f.attrs}
    onchange={(e) => {
      f.onInput(e.currentTarget.checked)
      f.setTouched()
    }}
  />
</FieldShell>
