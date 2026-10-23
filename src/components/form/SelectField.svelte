<script lang="ts">
  // Компонент приложения. Всё обязательное — имя, идентификатор, тип,
  // атрибуты проверки, связи доступности, начальное значение — в `attrs`.
  //
  // Контрол — enhanced `Select` примитива (не голый `NativeSelect`): список
  // рисует панель, значение и no-JS держит нативный `select` внутри него.
  // Короткий справочник едет в нативный список целиком (`nativeList: 'all'`):
  // это и поведение без JS, и `selectOption` в тестах. Длинный (студии
  // каталога — тысячи) без JS показывает первые `NATIVE_LIMIT` плюс
  // выбранное, с JS — ищет по всем, а нативный контрол держит только значение.
  import { onMount } from 'svelte'
  import { Select } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()

  const NATIVE_LIMIT = 200
  const options = $derived(f.options ?? [])
  const long = $derived(options.length > NATIVE_LIMIT)

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /** Без JS у длинного списка видна только часть: пояснение связано с контролом. */
  const noteId = $derived(`${f.attrs.id}-truncated`)
  const describedby = $derived(
    [f.attrs['aria-describedby'], long && !hydrated ? noteId : undefined].filter(Boolean).join(' ') || undefined,
  )
</script>

<FieldShell {f}>
  <Select
    {...f.attrs}
    aria-describedby={describedby}
    {options}
    placeholder={f.placeholder}
    value={Array.isArray(f.value) ? f.value.map(String) : (f.value == null ? '' : String(f.value))}
    multiple={f.input === 'multiselect'}
    config={{ nativeList: long ? 'value' : 'all', nativeLimit: NATIVE_LIMIT }}
    onblur={() => f.setTouched()}
    onchange={(values) => f.onInput(f.input === 'multiselect' ? values : (values[0] ?? ''))}
  />
  {#if long && !hydrated}
    <p id={noteId} class="text-xs text-muted-foreground" data-select-truncated>
      Без JavaScript в списке первые {NATIVE_LIMIT} из {options.length}; поиск по всем работает с JavaScript.
    </p>
  {/if}
</FieldShell>
