<script lang="ts">
  // Страница фильтров списка «Диска»: fallback модалки `drive.filters` для
  // no-JS. Форма та же, что в sidebar и модалке; без JS уходит POST, сервер
  // отвечает 303 на адрес списка. Оболочка — общий `EntryCard`.
  import { untrack } from 'svelte'
  import { EntryCard } from '#core/ui/index.js'
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
    <EntryCard
      title="Фильтры списка"
      description="Применить — вернуться к списку с этим срезом."
      class="shadow-sm"
    >
      {#snippet footer()}
        <a class="text-sm underline" href={data.backHref}>К списку без изменений</a>
        <DriveFilters
          initial={data.values}
          from={data.backHref}
          resetHref={data.resetHref}
          scopeLocked={data.scopeLocked}
        />
      {/snippet}
    </EntryCard>
  {/if}
</div>
