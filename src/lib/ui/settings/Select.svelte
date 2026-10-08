<script lang="ts">
  /**
   * Общий селектор панелей настроек: `NativeSelect`-примитив + опции парами.
   * Всё, что решает механизм формы (`form.field(...).attrs`: id, `aria-*`,
   * `value`, отключение, причина), проходит наружу через `...rest` — виджет
   * ничего не знает о связывании и не заводит второй алфавита атрибутов.
   */
  import { NativeSelect } from '$lib/ui/primitives'

  interface Props {
    name?: string
    value: string
    onChange?: (v: string) => void
    options: readonly (readonly [string, string])[]
    disabled?: boolean
    [key: string]: unknown
  }

  let { name, value = $bindable(), onChange, options, disabled = false, ...rest }: Props = $props()

  function handleChange(e: Event & { currentTarget: HTMLSelectElement }) {
    const val = e.currentTarget.value
    value = val
    onChange?.(val)
  }
</script>

<NativeSelect
  {name}
  size="sm"
  {value}
  {disabled}
  onchange={handleChange}
  {...rest}
>
  {#each options as [v, label] (v)}
    <option value={v} selected={v === value}>
      {label}
    </option>
  {/each}
</NativeSelect>
