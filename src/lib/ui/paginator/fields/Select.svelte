<script lang="ts">
  import { NativeSelect } from '$lib/ui/primitives'

  interface Props {
    name?: string
    value: string
    onChange?: (v: string) => void
    options: readonly (readonly [string, string])[]
    disabled?: boolean
  }

  let { name, value = $bindable(), onChange, options, disabled = false }: Props = $props()

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
>
  {#each options as [v, label] (v)}
    <option value={v} selected={v === value}>
      {label}
    </option>
  {/each}
</NativeSelect>
