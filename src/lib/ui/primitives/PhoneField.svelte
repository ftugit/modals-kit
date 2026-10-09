<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '../cn'
  import InputShell from './InputShell.svelte'
  import Select from './Select.svelte'

  const CODES = [
    { code: '+7', country: 'Россия, Казахстан', mask: [3, 3, 2, 2] },
    { code: '+375', country: 'Беларусь', mask: [2, 3, 2, 2] },
    { code: '+1', country: 'США, Канада', mask: [3, 3, 4] },
  ]

  const CODE_OPTIONS = CODES.map((item) => ({
    value: item.code,
    label: item.code,
    hint: item.country,
  }))

  function groupDigits(digits: string, mask: number[]): string {
    const parts: string[] = []
    let rest = digits
    for (const size of mask) {
      if (!rest) break
      parts.push(rest.slice(0, size))
      rest = rest.slice(size)
    }
    if (rest) parts.push(rest)
    return parts.length <= 1 ? parts.join('') : `${parts[0]} ${parts.slice(1).join('-')}`
  }

  interface Props {
    disabled?: boolean
    invalid?: boolean
    rounded?: boolean
    code?: string
    digits?: string
    name?: string
  }

  let {
    disabled = false,
    invalid = false,
    rounded = false,
    code = $bindable(CODES[0].code),
    digits = $bindable(''),
    name = 'phone',
  }: Props = $props()

  let mounted = $state(false)
  let fieldEl = $state<HTMLInputElement | null>(null)

  const currentCode = $derived(CODES.find((c) => c.code === code) ?? CODES[0])
  const formatted = $derived(groupDigits(digits, currentCode.mask))
  const total = $derived(currentCode.mask.reduce((sum, size) => sum + size, 0))
  const complete = $derived(digits.length === total)

  onMount(() => {
    mounted = true
  })

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const onlyDigits = e.currentTarget.value.replace(/\D/g, '').slice(0, total)
    digits = onlyDigits
    e.currentTarget.value = groupDigits(onlyDigits, currentCode.mask)
  }

  function handleCodeChange(newCode: string) {
    code = newCode
    const next = CODES.find((item) => item.code === newCode) ?? CODES[0]
    const limit = next.mask.reduce((sum, size) => sum + size, 0)
    digits = digits.slice(0, limit)
    if (fieldEl) fieldEl.value = groupDigits(digits, next.mask)
  }
</script>

<div class="flex flex-col gap-1.5">
  <label class="text-sm font-medium" for="demo-phone">
    Телефон <span class="font-normal text-muted-foreground">— пригодится для срочной связи</span>
  </label>
  <InputShell>
    <Select
      name="phone-code"
      options={CODE_OPTIONS}
      listWidth="auto"
      value={code}
      {disabled}
      wrapperClass="w-auto shrink-0"
      // Бывший `.phone-code.phone-code` (удвоенный класс повышал
      // специфичность над стилями триггера): ширина по содержимому, стык
      // с номером без скругления и без границы; без `field-sizing` —
      // фиксированные 5rem через @supports.
      class={cn(
        'w-auto pl-2.5 text-sm field-sizing-content min-w-[3.75rem] pr-5 rounded-e-none border-e-0 supports-[not_(field-sizing:content)]:w-20',
        rounded && 'rounded-l-full pl-4',
      )}
      onchange={(values: string[]) => handleCodeChange(values[0] ?? '+7')}
    />
    <input
      bind:this={fieldEl}
      id="demo-phone"
      {name}
      type="tel"
      inputmode="numeric"
      autocomplete="tel-national"
      maxlength={groupDigits('0'.repeat(total), currentCode.mask).length}
      placeholder={groupDigits('0'.repeat(total), currentCode.mask)}
      aria-invalid={invalid || (digits.length > 0 && !complete) || undefined}
      {disabled}
      value={formatted}
      class={cn(
        // Бывший `.phone-number`: стык с кодом — без скругления слева.
        'font-mono w-full rounded-r-md rounded-l-none border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        mounted && 'pr-9',
        rounded && 'rounded-r-full pr-10',
      )}
      oninput={handleInput}
    />
  </InputShell>
</div>
