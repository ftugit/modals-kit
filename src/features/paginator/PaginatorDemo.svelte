<script lang="ts">
  // Адрес здесь не читается и не пишется: страницу из `?page` / `?gallery` и навигацию
  // обслуживает URL-транспорт пагинатора, роутер ему отдаёт хост (канон: `bindsUrl`).
  import { PaginatorScope } from '$lib/paginate/svelte'
  import {
    DEFAULT_DEMO_CONFIG,
    GALLERY_NAME,
    demoName,
    ensureDemoPaginator,
    type DemoStore,
  } from './definition'
  import type { PaginatorLoaderData } from './loader'
  import DemoPaginator from './DemoPaginator.svelte'
  import GalleryDemo from './GalleryDemo.svelte'

  interface Props {
    loaderData: PaginatorLoaderData
  }

  let { loaderData }: Props = $props()

  let storeKind = $state<DemoStore>(DEFAULT_DEMO_CONFIG.store)
  const activeName = $derived(ensureDemoPaginator(storeKind))

</script>

<PaginatorScope
  snapshots={{
    [loaderData.defaultName]: loaderData.snapshot,
    [GALLERY_NAME]: loaderData.gallerySnapshot,
  }}
>
  <div class="py-10 sm:py-14">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-4xl font-semibold tracking-tight">Пагинатор</h1>
        <p class="mt-2 max-w-2xl text-muted-foreground">
          Headless-пагинация на Svelte 5 / SolidJS в духе TanStack: указатель и настройки в{' '}
          <code class="rounded bg-muted/70 px-1">?page</code>,{' '}
          <code class="rounded bg-muted/70 px-1">?page.size</code>,{' '}
          <code class="rounded bg-muted/70 px-1">?page.&lt;опция&gt;</code> (replace, без
          window-скролла) — как цепочка у модалок. Ссылкой можно поделиться: восстановится всё,
          включая раскладку и флаги. То же — через localStorage. Всё вокруг списка — отдельные
          компоненты из <code class="rounded bg-muted/70 px-1">ui/paginator</code>: уберите
          ненужные.
        </p>
        <p class="mt-2 max-w-2xl text-muted-foreground">
          Раздел один и на каталог, и на поиск — как страница Shikimori в исходнике. Источник
          выбирается опцией панели (товары, фото или каталог Shikimori: с его API разговаривает
          наш бэкенд, браузер ходит только на <code class="rounded bg-muted/70 px-1"
            >/api/anime</code
          >). Поиск — надстройка lib search, и его можно выключить двумя разными способами:
          целиком (<code class="rounded bg-muted/70 px-1">?page.search=false</code> — поля нет,
          запрос не учитывается) или только fuzzy-перехват (<code class="rounded bg-muted/70 px-1"
            >?page.fuzzy=false</code
          > — тогда запрос сужает выдачу родным поиском источника, у Shikimori это подстрока на
          бэкенде). Рядом с полем видно, что делает lib search: исправленный запрос и счётчики
          перехвата.
        </p>
        <p class="mt-2 max-w-2xl text-muted-foreground">
          Что источник умеет — знает САМ ИСТОЧНИК: пагинатор спрашивает у него возможности и
          передаёт их интерфейсу. У товаров и фото поиска нет — поле видно выключенным, с причиной,
          и такой параметр нельзя записать; у каталога Shikimori есть поиск и lib search, а общего
          числа записей API не отдаёт — поэтому номерные страницы у него не появляются. Переключение
          источника снимает ключи, которых у нового нет, обычной записью в хранилище (адрес или
          localStorage).
        </p>
      </div>
      <a
        href="/"
        class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        ← на главную
      </a>
    </div>

    <div class="mt-5">
      {#key activeName}
        {#if storeKind === 'url'}
          <DemoPaginator
            name={activeName}
            {storeKind}
            onStore={(s: DemoStore) => (storeKind = s)}
            url={{ snapshot: activeName === loaderData.defaultName ? loaderData.snapshot : null }}
          />
        {:else}
          <DemoPaginator
            name={activeName}
            {storeKind}
            onStore={(s: DemoStore) => (storeKind = s)}
          />
        {/if}
      {/key}
    </div>

    <p class="mt-3 text-xs text-muted-foreground">
      paginator name: <code data-testid="current-name">{demoName(storeKind)}</code>
      {#if storeKind === 'url'}
        {' · настройки и страница: GET ?page, ?page.size, ?page.<опция> (replace)'}
      {:else if storeKind === 'local'}
        {' · настройки и страница: localStorage (переживает reload)'}
      {:else if storeKind === 'none'}
        {' · настройки и страница: память (сбрасываются при reload)'}
      {/if}
    </p>

    <GalleryDemo snapshot={loaderData.gallerySnapshot} />
  </div>
</PaginatorScope>
