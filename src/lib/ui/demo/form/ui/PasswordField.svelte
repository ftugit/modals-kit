<script lang="ts">
  // Компонент приложения: пароль с показом (кнопка-глаз примитива появляется
  // после оживления). Шкала сложности — вариант 'strength', см. PasswordStrengthField.
  import { PasswordInput } from '#lib/components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <PasswordInput
    {...f.attrs}
    autocomplete="new-password"
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
