<script lang="ts">
  import { onMount } from 'svelte'
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { fieldBase } from '../field/field'

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
  {...rest}
  bind:this={textareaEl}
  bind:value
  rows={minLines}
  class={cn(
    fieldBase,
    'px-3 py-2 text-sm',
    'field-sizing-content resize-none min-h-[calc(var(--field-min-lines,1)*1lh_+_1rem_+_2px)] max-h-[calc(var(--field-max-lines,6)*1lh_+_1rem_+_2px)] transition-[color,border-color,box-shadow,height] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:duration-[1ms] data-[autosize=js]:overflow-y-hidden',
    cls,
  )}
  style={`--field-min-lines: ${minLines}; --field-max-lines: ${maxLines}; ${typeof style === 'string' ? style : ''}`}
  data-autosize={fallback ? 'js' : 'css'}
></textarea>
