<script lang="ts">
  // Порт CardView из src/features/modals/CardPage.tsx оригинала.

  let { data }: { data: import('./$types').PageData } = $props()
</script>

<div class="py-10 sm:py-14">
  <p class="text-xs uppercase tracking-wide text-muted-foreground">Карточка · SSR-страница</p>
  <h1 class="mt-2 text-3xl font-bold">{data.title}</h1>
  <p class="mt-4 max-w-prose text-muted-foreground">{data.body}</p>
  <p class="mt-6 text-sm text-muted-foreground">
    Эта страница — <code class="rounded bg-muted/70 px-1">route</code> модалки
    <code class="rounded bg-muted/70 px-1">card</code>: без JavaScript ссылка триггера ведёт
    сюда, с JavaScript тот же клик открывает модалку поверх демо.
  </p>
  <a
    href="/modals"
    class="mt-6 inline-block rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
  >
    ← К демо модалок
  </a>
</div>
