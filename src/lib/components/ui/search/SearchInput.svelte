<script lang="ts">
  import { onMount } from 'svelte'
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { IDLE_TASK, type TaskState } from '#lib/task/index.js'
  import { reflectTask } from '../../links/state.svelte.js'
  import SearchField from './SearchField.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'class'> {
    value?: string
    /** Классы обёртки (раскладка: ширина, flex). */
    class?: ClassValue | null
    /** Классы самого `<input>` (вид поля). */
    inputClass?: ClassValue | null
    clearLabel?: string
    onClear?: () => void
    /**
     * Задача, которую запустил ввод (`#lib/task`): выдача по запросу. Пока
     * `pending` — спиннер в поле (через 150 мс), `aria-busy`, глобальный лоадер.
     * Поле остаётся живым: можно дописывать.
     */
    task?: TaskState
  }

  let {
    value = $bindable(''),
    clearLabel = 'Очистить поиск',
    class: cls,
    inputClass,
    disabled = false,
    onClear,
    task,
    ...rest
  }: Props = $props()

  // Вложение — только когда задача есть; смена её состояния вложение не пересоздаёт.
  const hasTask = $derived(task !== undefined)
  const attachTask = (el: HTMLElement) => reflectTask(el, () => task ?? IDLE_TASK)

  let inputEl = $state<HTMLInputElement | null>(null)
  let mounted = $state(false)
  let filled = $derived(Boolean(value && value.length > 0))

  function clear() {
    value = ''
    if (inputEl) {
      inputEl.value = ''
      inputEl.dispatchEvent(new Event('input', { bubbles: true }))
      inputEl.focus({ preventScroll: true })
    }
    onClear?.()
  }

  onMount(() => {
    mounted = true
    const onReset = () => {
      value = ''
    }
    inputEl?.form?.addEventListener('reset', onReset)
    return () => inputEl?.form?.removeEventListener('reset', onReset)
  })
</script>

<SearchField
  {filled}
  onClear={clear}
  {clearLabel}
  disabled={!mounted || Boolean(disabled)}
  class={cls}
>
  <input
    {...rest}
    bind:this={inputEl}
    bind:value
    type="search"
    {disabled}
    {@attach hasTask ? attachTask : undefined}
    class={cn(
      'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 pr-9 [&::-webkit-search-cancel-button]:appearance-none',
      inputClass,
    )}
  />
  {#if hasTask}
    <!-- Показывает правило `input[data-state=loading] ~ [data-task-spinner]`
         (`components/links/indicator.ts`): задержку 150 мс держит `reflectTask`. -->
    <span data-task-spinner="" aria-hidden="true" class="pointer-events-none absolute inset-y-0 end-9 items-center text-muted-foreground">
      <span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"></span>
    </span>
  {/if}
</SearchField>
