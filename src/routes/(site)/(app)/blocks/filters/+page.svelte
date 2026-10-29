<script lang="ts">
  // Страница фильтров списка блокировок — fallback модалки `user.blocks.filters` для no-JS.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import BlocksFiltersForm from '#content/user/ui/BlocksFiltersForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Фильтры блокировок',
    description: 'Настройка фильтров журнала блокировок пользователей.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref={data.backHref} />
  {:else if data.fact}
    <Acl status={data.fact} backHref={data.backHref} />
  {:else}
    <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <h1 class="mb-1 text-base font-semibold">Фильтры блокировок</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        Применить — вернуться к списку с этим срезом.
        <a class="underline" href={data.backHref}>К списку без изменений</a>
      </p>
      <BlocksFiltersForm
        uid={data.uid}
        canSeeDeleted={data.canSeeDeleted}
        canSeeLive={data.canSeeLive}
        canPickUsers={data.canPickUsers}
        initial={data.values}
        selfHref={data.selfHref}
        action={data.action}
        hiddenFields={data.hiddenFields}
        resetHref={data.resetHref}
      />
    </div>
  {/if}
</div>
