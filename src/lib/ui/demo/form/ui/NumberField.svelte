<script lang="ts">
  // Число с кнопками «−/+» (примитив NumberField). Значение уходит в форму той же
  // строкой, что у TextField: разбор числа — работа типа значения, не компонента.
  import { NumberField } from '#lib/ui/primitives/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <NumberField
    {...f.attrs}
    autoWidth={f.variant === 'auto'}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
