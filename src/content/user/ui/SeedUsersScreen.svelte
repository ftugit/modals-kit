<script lang="ts">
  /**
   * Экран списка seed-юзеров — единственное место, где данные `load` роута
   * `/users` превращаются в экран (образец — `ProfileScreen`):
   *
   *  - `fact` — отказ сессии/доступа: экран `Acl` (для `auth.forbidden` —
   *    модельный экран «Доступ запрещён»: права на список проверяет домен, и
   *    отказ обязан звучать одинаково на странице и в модалке);
   *  - `snapshot` — первая порция пагинатора: список.
   *
   * Носителю (странице или модалке) знать про это нечего: он передаёт данные
   * и ничего не решает.
   *
   * Над списком — поиск и фильтры этапа 1: слева штатный `SearchBar`
   * пагинатора (источник объявил родной поиск по seed), справа кнопка
   * модалки фильтров со счётчиком применённых. Состояние обоих живёт в
   * пагинаторе (`extra`, ключи объявил источник) и в адресе (`?users.*`),
   * поэтому страница и модалка показывают один срез и после перезагрузки.
   */
  import { Paginator, SearchBar } from '#components/paginator/index.js'
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import SeedUserRow from './seed-users/SeedUserRow.svelte'
  import {
    ensureSeedUsersPaginator,
    SEED_USERS_FILTER_KEYS,
    SEED_USERS_NAME,
  } from './seed-users/source.js'

  interface Props {
    snapshot: PaginatorState<SeedUserView> | null
    fact: AuthErrorCode | null
    enabled?: boolean
    canSeeDeleted?: boolean
    variant?: UserSurfaceVariant
    class?: string
  }

  // `canSeeDeleted` в данных остаётся для носителей; экрану он больше не
  // нужен: доступность блока удалённых считает `load` страницы фильтров.
  let { snapshot, fact, enabled, variant = 'plain', class: className }: Props = $props()

  // Регистрация — на стороне экрана, в том же бандле, что и хост пагинатора.
  ensureSeedUsersPaginator()

  const asModalLink = useModalLink()
  const pagState = usePaginatorState<SeedUserView>(SEED_USERS_NAME)
  const query = $derived(
    typeof pagState().extra?.q === 'string' ? (pagState().extra.q as string) : '',
  )
  const activeFilters = $derived(
    SEED_USERS_FILTER_KEYS.filter((k) => {
      const v = pagState().extra?.[k]
      return typeof v === 'string' && v !== ''
    }).length,
  )
  // «Всего» — из живого состояния пагинатора: снапшот `load` честен только
  // на первой порции, дальше срез (поиск/фильтры) меняет totals без SSR.
  const totalItems = $derived(pagState().totalItems ?? snapshot?.totalItems)
  // No-JS адрес кнопки фильтров: страница `/users/filters`, которой текущий
  // адрес носителя уходит параметром `from` — форма вернёт GET именно сюда
  // (список может жить на любой странице и в модалке), а не на фиксированный
  // роут. Текущие фильтры страница прочитает из того же `from`.
  const filtersHref = $derived.by(() => {
    const qs = new URLSearchParams(
      Object.entries(currentSearch()).map(([k, v]) => [k, String(v)] as [string, string]),
    )
    const from = currentPathname() + (qs.size ? `?${qs}` : '')
    return `/users/filters?from=${encodeURIComponent(from)}`
  })
</script>

{#if fact === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" {variant} class={className} />
{:else if fact}
  <Acl status={fact} backHref="/" {variant} class={className} />
{:else if snapshot}
  <PaginatorScope snapshots={{ [SEED_USERS_NAME]: snapshot }}>
  <section class={className}>
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="text-base font-semibold">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: {totalItems ?? '—'}</span>
    </div>
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <SearchBar
          name={SEED_USERS_NAME}
          {query}
          label="Поиск по seed"
          placeholder="Подстрока seed…"
        />
      </div>
      <Button
        {...asModalLink('user.list.filters', {}, { href: filtersHref })}
        variant="outline"
        data-testid="seed-users-filters-open"
      >
        Фильтры{#if activeFilters}&nbsp;({activeFilters}){/if}
      </Button>
    </div>
    <Paginator
      name={SEED_USERS_NAME}
      ariaLabel="Список seed-юзеров"
      {snapshot}
      mode="accumulate"
      class="max-h-[420px]"
    >
      {#snippet renderItem(item: SeedUserView)}
        <SeedUserRow {item} />
      {/snippet}
    </Paginator>
  </section>
  </PaginatorScope>
{/if}
