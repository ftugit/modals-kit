<script lang="ts">
  // Компонент приложения для `field.phone(...)` (тип `phone` из ../extend.ts).
  // Значение — одна строка `+79991234567`: примитив склеивает код и номер сам и
  // отдаёт готовое значение; имя, id, подпись и связи доступности — из `attrs`.
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { PhoneInput } from '#lib/ui/primitives/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <PhoneInput
    {...f.attrs}
    value={String(f.value ?? '')}
    onblur={() => f.setTouched()}
    onValueChange={(v) => f.onInput(v)}
  />
</FieldShell>
