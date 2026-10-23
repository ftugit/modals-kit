<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import { fieldBase } from '../field/field'

  interface Props extends HTMLTextareaAttributes {}

  let { class: cls, value = $bindable(), ...rest }: Props = $props()
</script>

<textarea
  bind:value
  class={cn(fieldBase, 'min-h-20 px-3 py-2 text-sm', cls)}
  {...rest}
></textarea>
