<script lang="ts">
  // Компонент приложения. Всё обязательное — имя, идентификатор, тип,
  // атрибуты проверки, связи доступности, начальное значение — в `attrs`.
  import { Input } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  // У цвета «пусто» не бывает: пока значения нет, показываем значение по умолчанию
  // из описания (связка его в состояние не кладёт), браузер отправит то, что видно.
  // Только у цвета: текстовое поле с умолчанием иначе нельзя было бы очистить.
  // `defaultValue` — значение сброса формы: при оживлении Svelte снимает атрибут
  // `value`, и без него у цвета остаётся пустое умолчание (предупреждение браузера).
  const value = $derived(f.input === 'color' && !f.attrs.value ? (f.defaultValue ?? '#000000') : f.attrs.value)
</script>

<FieldShell {f}>
  <Input
    {...f.attrs}
    {value}
    defaultValue={f.input === 'color' ? value : undefined}
    placeholder={f.placeholder}
    autoWidth={f.variant === 'auto'}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
