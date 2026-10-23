<script lang="ts">
  import { Checkbox } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f} labelPlacement="end">
  <Checkbox
    {...f.attrs}
    onchange={(e) => {
      f.onInput(e.currentTarget.checked)
      f.setTouched()
    }}
  />
</FieldShell>
