<script lang="ts">
  import Button from '#components/ui/button/Button.svelte'
  import { useHeadSeo } from '#components/shell/index.js'
  import { asLink } from '#hooks/links/index.js'
  import SeedUsersEntry from '#content/user/ui/SeedUsersEntry.svelte'
  import StorageServersEntry from '#content/storage-servers/ui/StorageServersEntry.svelte'
  import { HOME_CARDS } from '../nav.js'

  useHeadSeo({
    title: 'modals-kit — главная',
    headerTitle: 'Главная',
    description:
      'Порт модальной системы SolidHono на Svelte 5 и SvelteKit: цепочка модалок в адресе, пагинатор, формы с валидацией, шаги, потоковая загрузка файлов и слой базы данных.',
  })
</script>

<div class="mx-auto w-full max-w-4xl">
  <div class="max-w-3xl">
    <span
      class="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
    >
      SvelteKit · Ark · порт SolidHono
    </span>
    <h1 class="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">modals-kit</h1>
    <p class="mt-5 text-lg leading-relaxed text-muted-foreground">
      Порт модальной системы SolidHono: цепочка живёт в адресе, стопка с хвостами,
      загрузчик работает до открытия, Назад/Вперёд закрывают и открывают модалки.
    </p>
  </div>
  <div class="mt-8 grid gap-4 sm:grid-cols-2">
    <SeedUsersEntry />
    <StorageServersEntry />
  </div>
  {#if HOME_CARDS.length > 0}
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each HOME_CARDS as d (d.href)}
        <section class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 class="text-xl font-semibold tracking-tight">{d.title}</h2>
          <p class="my-4 text-sm leading-relaxed text-muted-foreground">{d.text}</p>
          <Button {...asLink(d.href)}>{d.ctaLabel ?? 'Открыть демо'}</Button>
          {#if import.meta.env.DEV && d.devHref}
            <div class="mt-3">
              <Button {...asLink(d.devHref)} variant="outline">
                {d.devLabel ?? 'Dev'}
              </Button>
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>
