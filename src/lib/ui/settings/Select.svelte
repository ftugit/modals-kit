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
  import { Select } from '$lib/ui/primitives'

  interface Props {
    name?: string
    value: string
    onChange?: (v: string) => void
    options: readonly (readonly [string, string])[]
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
  options={options.map(([v, label]) => ({ value: v, label }))}
  config={{ nativeList: 'all' }}
  onchange={(vs) => {
    const val = vs[0] ?? ''
    value = val
    onChange?.(val)
  }}
  {...rest}
/>
