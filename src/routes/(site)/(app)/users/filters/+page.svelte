<script lang="ts">
  // Страница фильтров списка: fallback модалки для no-JS. Форма та же, что в
  // модалке (`SeedUsersFiltersForm`), режим нативный: GET на адрес носителя
  // списка (`action` из `from`), его `load` разберёт параметры в тот же срез.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SeedUsersFiltersForm from '#content/user/ui/SeedUsersFiltersForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Фильтры списка seed-юзеров',
    description: 'Настройка параметров фильтрации списка пользователей.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-1.5 text-lg font-semibold leading-tight tracking-tight">Фильтры списка</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        Применить — вернуться к списку с этим срезом.
        <a class="underline" href={data.backHref}>К списку без изменений</a>
      </p>
      <SeedUsersFiltersForm
        canSeeDeleted={data.canSeeDeleted}
        canSeeNickname={data.canSeeNickname}
        initial={data.values}
        action={data.action}
        hiddenFields={data.hiddenFields}
        resetHref={data.resetHref}
      />
    </div>
  {/if}
</div>
