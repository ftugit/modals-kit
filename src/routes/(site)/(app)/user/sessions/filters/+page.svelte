<script lang="ts">
  // Страница фильтров списка: fallback модалки для no-JS. Форма та же, что в
  // модалке. Без JS она уходит POST, сервер отвечает 303 на адрес списка.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionsFiltersForm from '#content/user/ui/SessionsFiltersForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Фильтры сессий',
    description: 'Настройка параметров выборки устройств аккаунта.',
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
      {#key `${data.canSeeDeleted}:${data.countries.join(',')}`}
        <SessionsFiltersForm
          canSeeDeleted={data.canSeeDeleted}
          countries={data.countries}
          initial={data.values}
          from={data.backHref}
          resetHref={data.resetHref}
        />
      {/key}
    </div>
  {/if}
</div>
