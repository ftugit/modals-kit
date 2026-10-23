<script lang="ts">
  // Корневая граница ошибок: маршруты вне каркаса (/cycle, /spike — у них свой
  // каркас внутри демо) и сбой самого каркаса `(site)` (его load). Каркаса здесь
  // нет, поэтому ориентир `<main>` ставит граница (B4). Ошибки сайта ловит
  // `(site)/+error.svelte` — внутри каркаса, как и прежде.
  import ErrorPage from '#components/ErrorPage.svelte'
</script>

<main><ErrorPage /></main>
