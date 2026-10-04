<script lang="ts">
  // Компонент приложения. Всё обязательное — имя, идентификатор, тип,
  // атрибуты проверки, связи доступности, начальное значение — в `attrs`.
  import { inputVariants } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <input
    {...f.attrs}
    class={inputVariants()}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
