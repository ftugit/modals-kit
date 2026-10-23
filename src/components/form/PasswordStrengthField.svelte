<script lang="ts">
  // Компонент приложения для `field.password({ variant: 'strength' })`.
  // Шкалу считает ТА ЖЕ функция, что и валидатор `v.strength`: иначе шкала
  // и проверка разошлись бы, и пользователь видел бы «надёжный» там, где
  // форма не пропускает.
  import { strengthOf, type StrengthLevel } from '#lib/form/index.js'
  import { PasswordStrength } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()

  const LABEL: Record<StrengthLevel, string> = {
    weak: 'слабый', fair: 'средний', good: 'хороший', strong: 'надёжный',
  }
  const ORDER: StrengthLevel[] = ['weak', 'fair', 'good', 'strong']

  const value = $derived(String(f.value ?? ''))
  const s = $derived(strengthOf(value))
</script>

<FieldShell {f}>
  <PasswordStrength
    {...f.attrs}
    autocomplete="new-password"
    score={value ? ORDER.indexOf(s.level) + 1 : 0}
    label="{LABEL[s.level]} · {s.bits} бит"
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
