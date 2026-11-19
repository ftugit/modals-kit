<script lang="ts">
  // Страница фильтров списка «Диска»: fallback модалки `drive.filters` для
  // no-JS. Форма та же, что в sidebar и модалке; без JS уходит POST, сервер
  // отвечает 303 на адрес списка.
  import { untrack } from 'svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import DriveFilters from '#modules/drive/ui/filters/DriveFilters.svelte'
  import type { DriveFiltersPageData } from '#modules/drive/types.js'

  let { data }: { data: DriveFiltersPageData } = $props()

  useHeadSeo({
    subTitle: untrack(() => 'Фильтры диска'),
    description: 'Настройка параметров фильтрации файлов и папок диска.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-1.5 text-lg font-semibold leading-tight tracking-tight">Фильтры списка</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        Применить — вернуться к списку с этим срезом.
        <a class="underline" href={data.backHref}>К списку без изменений</a>
      </p>
      <DriveFilters
        initial={data.values}
        from={data.backHref}
        resetHref={data.resetHref}
        scopeLocked={data.scopeLocked}
      />
    </div>
  {/if}
</div>
