<script lang="ts">
  // Группа радиокнопок — по эталону shadcn/ui v4 (`ui/radio-group.tsx`),
  // собранная на нативных `<input type="radio">` (`RadioItem`): работает одинаково
  // с JS и без JS, а spread `rest` на первой кнопке сохраняет `ATTACH`-ключ `#lib/form`
  // (автопрокрутка и автофокус на поле при ошибке валидации).
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import Label from '../label/Label.svelte'
  import RadioItem from './RadioItem.svelte'

  export interface RadioOption {
    value: string
    label: string
    disabled?: boolean
  }

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size' | 'class' | 'onchange'> {
    options: readonly RadioOption[]
    value?: string
    wrapperClass?: ClassValue | null
    class?: ClassValue | null
    onchange?: (value: string, event: Event & { currentTarget: EventTarget & HTMLInputElement }) => void
  }

  let {
    options,
    value = $bindable(''),
    name,
    id,
    form,
    required = false,
    disabled = false,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedby,
    wrapperClass,
    class: cls,
    onchange,
    ...rest
  }: Props = $props()

  const fallbackPrefix = `radio-${Math.random().toString(36).slice(2, 9)}`
  const prefix = $derived(id ?? fallbackPrefix)

  function handleChange(optValue: string, e: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    if (!e.currentTarget.checked) return
    value = optValue
    onchange?.(optValue, e)
  }
</script>

<div
  role="radiogroup"
  data-slot="radio-group"
  aria-describedby={ariaDescribedby}
  class={cn('grid gap-3', wrapperClass)}
>
  {#each options as option, i (option.value)}
    {@const itemId = i === 0 && id ? id : `${prefix}-${i}`}
    {@const itemDisabled = disabled || Boolean(option.disabled)}
    <div class="flex items-center gap-2.5">
      <RadioItem
        {...(i === 0 ? rest : {})}
        id={itemId}
        {name}
        {form}
        value={option.value}
        required={required && i === 0 ? true : undefined}
        disabled={itemDisabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        checked={value === option.value}
        class={cls}
        onchange={(e) => handleChange(option.value, e)}
      />
      <Label for={itemId} class={cn('cursor-pointer font-normal', itemDisabled && 'cursor-not-allowed opacity-50')}>
        {option.label}
      </Label>
    </div>
  {/each}
</div>
