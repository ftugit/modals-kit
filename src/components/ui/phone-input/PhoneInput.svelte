<script lang="ts">
  // Телефон одной строкой (`+79991234567`). Образец — phone input для shadcn
  // (omeralpi/shadcn-phone-input: выбор страны встык с полем, значение E.164) и
  // Input Group из shadcn v4: код страны — текст ВНУТРИ рамки поля, а не соседний
  // контрол. Здесь это InputShell + InputAffix слева, в нём — примитив Select проекта
  // (поиск по коду и стране, список через хост модалок) без рамки и фона.
  //
  // До оживления (и без JS) — одно обычное поле `type="tel"` с именем: номер целиком,
  // сервер приводит его к одной строке. После — код + национальная часть без имён и
  // скрытое поле с именем, в которое собирается значение. Имя, id, подпись и атрибуты
  // проверки приходят снаружи (из формы), примитив своих не придумывает.
  import { onMount, untrack } from 'svelte'
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import { inputVariants } from '../field/field'
  import InputAffix from '../input/InputAffix.svelte'
  import InputShell from '../input/InputShell.svelte'
  import Select from '../select/Select.svelte'
  import {
    PHONE_COUNTRIES, cleanNational, formatNational, joinPhone, placeholderFor, splitPhone, type PhoneCountry,
  } from './phone'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'class' | 'size'> {
    /** Значение: номер одной строкой (`+79991234567`) или пусто. */
    value?: string
    countries?: readonly PhoneCountry[]
    /** Код страны для пустого поля и для номера без кода; по умолчанию — первый в списке. */
    defaultCode?: string
    /** Доступное имя списка кодов. */
    codeLabel?: string
    /** Классы видимого поля номера. */
    class?: ClassValue | null
    /** Классы внешней обёртки (`InputShell`). */
    wrapperClass?: ClassValue | null
    /** Новое значение после ввода или смены кода — уже склеенное. */
    onValueChange?: (value: string) => void
  }

  let {
    value = $bindable(''),
    countries = PHONE_COUNTRIES,
    defaultCode,
    codeLabel = 'Код страны',
    class: cls,
    wrapperClass,
    onValueChange,
    // атрибуты, которые относятся к номеру ЦЕЛИКОМ: у поля без JS — да, у национальной
    // части — нет (имя несёт скрытое поле, шаблон и длины описывают полный номер)
    name,
    placeholder,
    pattern,
    minlength,
    maxlength,
    autocomplete,
    inputmode,
    disabled = false,
    oninput,
    ...rest
  }: Props = $props()

  const fallback = $derived(countries.find((c) => c.code === defaultCode) ?? countries[0]!)
  // первый показ (в том числе на сервере); дальше значение сверяет эффект ниже
  const initial = untrack(() => splitPhone(value ?? '', countries, fallback))
  let country = $state<PhoneCountry>(initial.country)
  let national = $state(initial.national)
  const joined = $derived(joinPhone(country.code, national))

  let mounted = $state(false)
  let plainEl = $state<HTMLInputElement | null>(null)
  let nationalEl = $state<HTMLInputElement | null>(null)
  let hiddenEl = $state<HTMLInputElement | null>(null)
  let affixWidth = $state(0)

  const digitsOf = (s: string) => s.replace(/\D/g, '')

  function emit(next: string) {
    // скрытое поле — сразу: форма читает FormData в том же обработчике ввода
    if (hiddenEl) hiddenEl.value = next
    value = next
    onValueChange?.(next)
  }

  // Значение сменили снаружи (сброс формы, ответ сервера) — разобрать заново.
  $effect(() => {
    const v = value ?? ''
    untrack(() => {
      if (v === joinPhone(country.code, national)) return
      const r = splitPhone(v, countries, fallback)
      country = r.country
      national = r.national
    })
  })

  onMount(() => {
    // Набранное до оживления не теряем: в поле без JS был номер целиком.
    const typed = plainEl?.value ?? ''
    const focused = plainEl !== null && document.activeElement === plainEl
    if (typed !== (value ?? '')) {
      const r = splitPhone(typed, countries, fallback)
      country = r.country
      national = r.national
      emit(joinPhone(r.country.code, r.national))
    }
    mounted = true
    if (focused) queueMicrotask(() => nationalEl?.focus({ preventScroll: true }))
  })

  /** Позиция курсора после `n`-й цифры показанного текста. */
  function caretAfter(shown: string, n: number): number {
    if (n <= 0) return 0
    let seen = 0
    for (let i = 0; i < shown.length; i++) if (/\d/.test(shown[i]!) && ++seen === n) return i + 1
    return shown.length
  }

  function onNational(e: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const el = e.currentTarget
    const typed = el.value
    const before = digitsOf(typed.slice(0, el.selectionStart ?? typed.length)).length
    let caret = before
    if (/^\s*(\+|00)/.test(typed)) {
      // вставили или автозаполнили номер целиком — код берём из него
      const r = splitPhone(typed, countries, country)
      country = r.country
      national = r.national
      caret = r.national.length
    } else {
      let next = cleanNational(typed, country)
      // стёрли разделитель: цифры те же — стираем цифру рядом, как ожидает пользователь
      const kind = (e as unknown as InputEvent).inputType ?? ''
      if (next === national && kind.startsWith('delete') && typed.length < formatNational(national, country).length) {
        const at = kind === 'deleteContentBackward' ? before - 1 : before
        if (at >= 0 && at < next.length) {
          next = next.slice(0, at) + next.slice(at + 1)
          caret = at
        }
      }
      if (next.length < digitsOf(typed).length) caret = Math.min(caret, next.length)
      national = next
    }
    const shown = formatNational(national, country)
    el.value = shown
    const pos = caretAfter(shown, caret)
    if (document.activeElement === el) el.setSelectionRange(pos, pos)
    emit(joinPhone(country.code, national))
    oninput?.(e)
  }

  // Подпись в поле — сам код, страна — пояснение в списке (поиск идёт по обоим).
  const codeOptions = $derived(countries.map((c) => ({ value: c.code, label: c.code, hint: c.label })))

  function onCode(values: string[]) {
    const next = countries.find((c) => c.code === values[0]) ?? fallback
    country = next
    national = cleanNational(national, next)
    emit(joinPhone(next.code, national))
    nationalEl?.focus({ preventScroll: true })
  }
</script>

{#if !mounted}
  <InputShell class={wrapperClass} data-phone-input="">
    <input
      {...rest}
      bind:this={plainEl}
      {name}
      {placeholder}
      {pattern}
      {minlength}
      {maxlength}
      autocomplete={autocomplete ?? 'tel'}
      inputmode={inputmode ?? 'tel'}
      type="tel"
      value={value ?? ''}
      {disabled}
      class={cn(inputVariants(), cls)}
    />
  </InputShell>
{:else}
  <InputShell class={wrapperClass} data-phone-input="">
    <!-- Код — первым и в разметке: порядок табуляции совпадает с чтением (код, номер).
         Ширина кода меряется, отступ поля номера следует за ней. -->
    <InputAffix side="start" interactive class="pl-1">
      <span
        bind:offsetWidth={affixWidth}
        class="inline-flex h-full items-center rounded-sm has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring/30"
        data-phone-code=""
      >
        <!-- Примитив Select без имени: код — способ ввода, в форму уходит склейка.
             Рамку, фон и тень снимаем — код читается как часть поля. -->
        <Select
          aria-label={codeLabel}
          options={codeOptions}
          value={country.code}
          disabled={disabled ?? false}
          listWidth="auto"
          wrapperClass="w-auto"
          class="h-8 w-auto gap-1 border-0 bg-transparent px-2 tabular-nums shadow-none focus-visible:ring-0 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
          config={{ showClear: false, showSelectAll: false, showCount: false }}
          onchange={onCode}
        />
      </span>
    </InputAffix>
    <input
      {...rest}
      bind:this={nationalEl}
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      placeholder={placeholderFor(country)}
      value={formatNational(national, country)}
      {disabled}
      class={cn(inputVariants(), 'tabular-nums', cls)}
      style:padding-left={affixWidth ? `calc(${affixWidth}px + 0.25rem)` : `calc(${country.code.length}ch + 2rem)`}
      oninput={onNational}
    />
    <input bind:this={hiddenEl} type="hidden" {name} value={joined} {disabled} />
  </InputShell>
{/if}
