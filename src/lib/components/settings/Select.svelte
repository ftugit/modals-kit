<script lang="ts">
  /**
   * Общий селектор панелей настроек: enhanced `Select`-примитив + опции
   * парами. Всё, что решает механизм формы (`form.field(...).attrs`: id,
   * `aria-*`, `value`, отключение, причина), проходит наружу через `...rest` —
   * виджет ничего не знает о связывании и не заводит второй алфавита
   * атрибутов.
   *
   * Список рисует панель примитива (поиск, подсветка, host-owned раскрытие),
   * значением владеет нативный `select` внутри него — как у фильтров
   * каталога. `nativeList: 'all'`: у панов короткие списки, полный нативный
   * список дешёв и нужен no-JS и тестам (`selectOption`).
   */
  import { Select, type SelectOption } from '#lib/components/ui/index.js'

  interface Props {
    name?: string
    value: string
    onChange?: (v: string) => void
    /** Пара `[value, label]` или полный вариант (`disabled`/`hint`) — jsOnly и пр. */
    options: readonly (readonly [string, string] | SelectOption)[]
    disabled?: boolean
    [key: string]: unknown
  }

  let { name, value = $bindable(), onChange, options, disabled = false, ...rest }: Props = $props()
</script>

<Select
  {name}
  size="sm"
  {value}
  {disabled}
  options={options.map((o) =>
    Array.isArray(o) ? { value: o[0], label: o[1] } : (o as SelectOption),
  )}
  config={{ nativeList: 'all' }}
  onchange={(vs) => {
    const val = vs[0] ?? ''
    value = val
    onChange?.(val)
  }}
  {...rest}
/>
