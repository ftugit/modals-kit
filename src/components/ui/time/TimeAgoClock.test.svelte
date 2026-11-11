<script lang="ts">
  import TimeAgo from './TimeAgo.svelte'
  let fixed = $state(true)
  let first = $state(true)
  let second = $state(true)
  const value = 1_000
</script>

<button data-toggle onclick={() => fixed = !fixed}>Переключить время</button>
<button data-first onclick={() => first = !first}>Первый</button>
<button data-second onclick={() => second = !second}>Второй</button>
{#if first}<span data-clock="first"><TimeAgo {value} now={fixed ? value : undefined} /></span>{/if}
{#if second}<span data-clock="second"><TimeAgo {value} now={fixed ? value : undefined} /></span>{/if}
