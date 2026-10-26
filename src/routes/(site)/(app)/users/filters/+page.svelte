<script lang="ts">
  // Страница фильтров списка: fallback модалки для no-JS. Форма та же, что в
  // модалке (`SeedUsersFiltersForm`), режим нативный: GET на адрес носителя
  // списка (`action` из `from`), его `load` разберёт параметры в тот же срез.
  import Acl from '#content/user/ui/Acl.svelte'
  import SeedUsersFiltersForm from '#content/user/ui/SeedUsersFiltersForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Фильтры списка seed-юзеров</title></svelte:head>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <h1 class="mb-1 text-base font-semibold">Фильтры списка</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        Применить — вернуться к списку с этим срезом.
        <a class="underline" href={data.backHref}>К списку без изменений</a>
      </p>
      <SeedUsersFiltersForm
        canSeeDeleted={data.canSeeDeleted}
        initial={data.values}
        action={data.action}
        hiddenFields={data.hiddenFields}
        resetHref={data.resetHref}
      />
    </div>
  {/if}
</div>
