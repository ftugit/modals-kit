<script lang="ts">
  // Радиогруппа (`radio`): явный набор вариантов из `f.options`, работает одинаково
  // с JS и без JS за счёт нативных `<input type="radio">` внутри `RadioGroup`.
  import { RadioGroup } from '#lib/components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  const options = $derived(f.options ?? [])
  const value = $derived(f.value == null ? '' : String(f.value))
</script>

<FieldShell {f}>
  <RadioGroup
    {...f.attrs}
    {options}
    {value}
    onblur={() => f.setTouched()}
    onchange={(next) => {
      f.onInput(next)
      f.setTouched()
    }}
  />
</FieldShell>
