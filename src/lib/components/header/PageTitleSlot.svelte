<script lang="ts">
  // Заголовок текущей страницы для шапки.
  import { usePage } from '$lib/shell/page.svelte'

  const page = usePage()
  const displayTitle = $derived(page.seo.subTitle ?? page.seo.title ?? '')
</script>

{#if displayTitle}
  <span class="hidden truncate text-sm font-semibold opacity-80 sm:block">
    {displayTitle}
  </span>
{/if}
