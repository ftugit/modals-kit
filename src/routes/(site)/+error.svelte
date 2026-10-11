<script lang="ts">
  // Граница ошибок сайта: страница ошибки рисуется ВНУТРИ каркаса (шапка,
  // сайдбар, `<main>` AppShell) — и для ошибок страниц, и для неизвестных
  // адресов (catch-all `[...path]`).
  import ErrorPage from '#lib/components/ErrorPage.svelte'
</script>

<ErrorPage />
