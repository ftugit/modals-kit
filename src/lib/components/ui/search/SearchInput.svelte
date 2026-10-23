<script lang="ts">
  import { onMount } from 'svelte'
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { IDLE_TASK, type TaskState } from '#lib/task/index.js'
  import { reflectTask } from '../../links/state.svelte.js'
  import { fieldBase } from '../field/field'
  import Spinner from '../spinner/Spinner.svelte'
  import SearchField from './SearchField.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'class'> {
    value?: string
    /** Классы самого `<input>` (вид поля). */
    class?: ClassValue | null
    /** Классы внешней обёртки (`SearchField`). */
    wrapperClass?: ClassValue | null
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
    wrapperClass,
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
  class={wrapperClass}
>
  <input
    {...rest}
    bind:this={inputEl}
    bind:value
    type="search"
    {disabled}
    {@attach hasTask ? attachTask : undefined}
    class={cn(
      fieldBase,
      'px-3 py-2 pr-9 text-sm [&::-webkit-search-cancel-button]:appearance-none',
      cls,
    )}
  />
  {#if hasTask}
    <!-- Показывает правило `input[data-state=loading] ~ [data-task-spinner]`
         (`components/links/indicator.ts`): задержку 150 мс держит `reflectTask`. -->
    <span data-task-spinner="" aria-hidden="true" class="pointer-events-none absolute inset-y-0 end-9 items-center text-muted-foreground">
      <Spinner size="sm" />
    </span>
  {/if}
</SearchField>
