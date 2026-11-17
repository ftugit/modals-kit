<script lang="ts">
  // Число с кнопками «−/+» (примитив NumberField). Значение уходит в форму той же
  // строкой, что у TextField: разбор числа — работа типа значения, не компонента.
  import { NumberField } from '#core/ui/index.js'
  import type { FieldView } from '#core/lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <NumberField
    {...f.attrs}
    placeholder={f.placeholder}
    autoWidth={f.variant === 'auto'}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
