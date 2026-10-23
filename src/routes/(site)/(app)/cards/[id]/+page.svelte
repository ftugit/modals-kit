<script lang="ts">
  import Button from '#lib/components/ui/button/Button.svelte'
  import { asLink } from '#lib/components/links/index.js'
  // Порт CardView из src/features/modals/CardPage.tsx оригинала.

  let { data }: import('./$types').PageProps = $props()
</script>

<div class="mx-auto w-full max-w-4xl">
  <p class="text-xs uppercase tracking-wide text-muted-foreground">Карточка · SSR-страница</p>
  <h1 class="mt-2 text-3xl font-bold">{data.title}</h1>
  <p class="mt-4 max-w-prose text-muted-foreground">{data.body}</p>
  <p class="mt-6 text-sm text-muted-foreground">
    Эта страница — <code class="rounded bg-muted/70 px-1">route</code> модалки
    <code class="rounded bg-muted/70 px-1">card</code>: без JavaScript ссылка триггера ведёт
    сюда, с JavaScript тот же клик открывает модалку поверх демо.
  </p>
  <Button {...asLink('/modals')} variant="outline" size="sm" class="mt-6">← К демо модалок</Button>
</div>
