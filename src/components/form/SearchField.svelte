<script lang="ts">
  // Поле поиска с крестиком очистки (примитив SearchInput). Крестик шлёт обычное
  // событие ввода с пустым значением — форма узнаёт об очистке тем же путём.
  import { SearchInput } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <SearchInput
    {...f.attrs}
    value={String(f.value ?? '')}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
