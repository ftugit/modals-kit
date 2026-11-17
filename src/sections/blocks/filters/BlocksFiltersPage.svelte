<script lang="ts">
  // Страница фильтров списка блокировок — fallback модалки для no-JS.
  // Форма уходит POST, сервер отвечает 303 на адрес списка.
  import type { loadBlocksFilters } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlocksFiltersForm from '#modules/user/blocks/svelte/BlocksFiltersForm.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadBlocksFilters>> } = $props()

  useHeadSeo({
    subTitle: 'Фильтры блокировок',
    description: 'Настройка фильтров журнала блокировок пользователей.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.backHref} />
  {:else}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-1.5 text-lg font-semibold leading-tight tracking-tight">Фильтры блокировок</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        Применить — вернуться к списку с этим срезом.
        <a class="underline" href={data.backHref}>К списку без изменений</a>
      </p>
      {#key `${data.canSeeDeleted}:${data.canSeeLive}`}
        <BlocksFiltersForm
          uid={data.uid}
          canSeeDeleted={data.canSeeDeleted}
          canSeeLive={data.canSeeLive}
          canPickUsers={data.canPickUsers}
          initial={data.values}
          selfHref={data.selfHref}
          from={data.backHref}
          resetHref={data.resetHref}
        />
      {/key}
    </div>
  {/if}
</div>
