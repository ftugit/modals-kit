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
    'field-autosize',
    cls,
  )}
  style={`--field-min-lines: ${minLines}; --field-max-lines: ${maxLines}; ${typeof style === 'string' ? style : ''}`}
  data-autosize={fallback ? 'js' : 'css'}
  {...rest}
></textarea>
