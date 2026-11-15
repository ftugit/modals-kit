<script lang="ts">
  /**
   * ПРИМЕР своей разметки демо-панели (`ui` как `form` у фильтров): поля
   * расставлены руками, панель даёт готовые вьюхи (`field(name)`), значения,
   * причину выключения и варианты списка с учётом `jsOnly` до оживления.
   *
   * Раскладка нарочно не дефолтная: режим — во всю ширину сверху, тумблеры —
   * рядом под ним. Адрес, seed и «Применить» ведёт сама панель (DemoPanel).
   */
  import type { DemoUiProps } from '#components/demo/index.js'
  import { Field, Select, Toggle } from '#components/settings/index.js'

  let { field, form }: DemoUiProps = $props()

  const mode = $derived(field('demo'))
  const nav = $derived(field('nav'))
  const filled = $derived(field('filled'))
</script>

<div class="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
  <div class="md:col-span-2">
    <Field label={mode.v.label ?? 'Режим демо'} hint={mode.hint} hintId={`${mode.v.attrs.id}-help`}>
      <Select
        {...mode.v.attrs}
        name={mode.v.name}
        value={mode.v.value === undefined || mode.v.value === null ? '' : String(mode.v.value)}
        disabled={mode.disabled}
        options={mode.options}
      />
    </Field>
  </div>
  <Toggle
    {...nav.v.attrs}
    name={nav.v.name}
    label={nav.v.label ?? 'Навигация по шагам сверху'}
    checked={nav.v.value === true}
    disabled={nav.disabled}
    hint={nav.hint}
    hintId={`${nav.v.attrs.id}-help`}
    hiddenPair={form.submitVisible}
  />
  <Toggle
    {...filled.v.attrs}
    name={filled.v.name}
    label={filled.v.label ?? 'Пройденные шаги — ссылками'}
    checked={filled.v.value === true}
    disabled={filled.disabled}
    hint={filled.hint}
    hintId={`${filled.v.attrs.id}-help`}
    hiddenPair={form.submitVisible}
  />
</div>
