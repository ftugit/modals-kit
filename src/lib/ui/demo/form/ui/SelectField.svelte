<script lang="ts">
  // Компонент приложения. Всё обязательное — имя, идентификатор, тип,
  // атрибуты проверки, связи доступности, начальное значение — в `attrs`.
  //
  // Контрол — enhanced `Select` примитива (не голый `NativeSelect`): список
  // рисует панель, значение и no-JS держит нативный `select` внутри него.
  // `nativeList: 'all'` — справочники формы коротенькие, экономить разметку
  // нечего, а полный нативный список сохраняет и поведение формы без JS, и
  // совместимость с `selectOption` в тестах.
  import { Select } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <Select
    {...f.attrs}
    options={f.options ?? []}
    value={Array.isArray(f.value) ? f.value.map(String) : (f.value == null ? '' : String(f.value))}
    config={{ nativeList: 'all' }}
    onblur={() => f.setTouched()}
    onchange={(values) => f.onInput(values[0] ?? '')}
  />
</FieldShell>
