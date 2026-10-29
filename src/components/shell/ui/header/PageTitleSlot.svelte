<script lang="ts">
  // Заголовок активного маршрута для шапки (`activeSeo` не дублирует имя сайта до монтирования страницы).
  import { usePage } from '#components/shell/page.svelte.js'

  const page = usePage()
  const displayTitle = $derived(
    page.activeSeo.headerTitle ?? page.activeSeo.subTitle ?? page.activeSeo.title ?? '',
  )
</script>

{#if displayTitle}
  <span class="hidden truncate text-sm font-semibold opacity-80 sm:block">
    {displayTitle}
  </span>
{/if}
