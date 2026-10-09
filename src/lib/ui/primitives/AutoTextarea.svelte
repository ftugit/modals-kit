<script lang="ts">
  import { onMount } from 'svelte'
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLTextareaAttributes {
    minLines?: number
    maxLines?: number
  }

  let {
    minLines = 1,
    maxLines = 6,
    class: cls,
    style = '',
    value = $bindable(),
    ...rest
  }: Props = $props()

  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let fallback = $state(false)

  function resize() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = `${textareaEl.scrollHeight}px`
  }

  onMount(() => {
    const supports = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')
    if (supports) return
    fallback = true
    resize()
    textareaEl?.addEventListener('input', resize)
    return () => textareaEl?.removeEventListener('input', resize)
  })
</script>

<textarea
  bind:this={textareaEl}
  bind:value
  rows={minLines}
  class={cn(
    'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
    // Бывший `.field-autosize`: размер по содержимому, пол и потолок по
    // числу строк (переменные приходят из style ниже), резервный путь без
    // `field-sizing` прячет переполнение — как делал @supports-блок.
    'field-sizing-content resize-none min-h-[calc(var(--field-min-lines,1)*1lh_+_1.25rem)] max-h-[calc(var(--field-max-lines,6)*1lh_+_1.25rem)] transition-[height] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:duration-[1ms] data-[autosize=js]:overflow-y-hidden',
    cls,
  )}
  style={`--field-min-lines: ${minLines}; --field-max-lines: ${maxLines}; ${typeof style === 'string' ? style : ''}`}
  data-autosize={fallback ? 'js' : 'css'}
  {...rest}
></textarea>
