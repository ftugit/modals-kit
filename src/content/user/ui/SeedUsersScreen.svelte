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
  import { Paginator, SearchBar, Skeleton } from '#components/paginator/index.js'
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
    SEED_USERS_EXTRA_DEFAULTS,
    SEED_USERS_FILTER_KEYS,
    SEED_USERS_NAME,
    SEED_USERS_PAGE_SIZE,
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
  // Счётчик — только реальные отличия от среза по умолчанию: URL-адаптер
  // материализует дефолты (`ord=created-desc`, `state=active`) в `extra`,
  // и без этого сравнения кнопка вечно показывала бы «(2)» на чистом списке.
  // Размер порции живёт не в `extra`, а в состоянии пагинатора — его
  // отличие от умолчания считается отдельным слагаемым.
  const activeFilters = $derived(
    SEED_USERS_FILTER_KEYS.filter((k) => {
      const v = pagState().extra?.[k]
      const fallback = (SEED_USERS_EXTRA_DEFAULTS as Record<string, string>)[k]
      return typeof v === 'string' && v !== '' && v !== fallback
    }).length + (pagState().pageSize !== SEED_USERS_PAGE_SIZE ? 1 : 0),
  )
  // Параметр никнейма включён текущим срезом (ключ `nick` адреса) — подпись
  // поиска обещает и никнейм. Право и сам столбец решает сервер.
  const nickOn = $derived(pagState().extra?.nick === '1')
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
          label={nickOn ? 'Поиск по seed, id и никнейму' : 'Поиск по seed и id'}
          placeholder={nickOn ? 'Подстрока seed, id или никнейма…' : 'Подстрока seed или id…'}
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
      topTrigger="direction"
      bottomTrigger="direction"
      topZone="40%"
      bottomZone="40%"
      renderDivider={null}
      class="max-h-[420px]"
    >
      {#snippet renderItem(item: SeedUserView)}
        <SeedUserRow {item} />
      {/snippet}
      {#snippet renderSkeleton()}
        <!--
          Скелетон повторяет геометрию строки списка, а не один серый блок:
          те же сегменты, что у SeedUserRow. Блок никнейма — только при
          включённом параметре: выключен — у скелетона его нет, как нет
          столбца у настоящих строк.
        -->
        <div class="flex items-center gap-3 px-2 py-2" data-testid="seed-user-skeleton">
          <Skeleton class="h-4 min-w-0 flex-1" />
          {#if nickOn}
            <span class="w-24 shrink-0" data-testid="seed-user-skeleton-nickname">
              <Skeleton class="h-3 w-full" />
            </span>
          {/if}
          <Skeleton class="h-3 w-28 shrink-0" />
          <Skeleton class="h-3 w-24 shrink-0" />
          <Skeleton class="h-3 w-16 shrink-0" />
        </div>
      {/snippet}
    </Paginator>
  </section>
  </PaginatorScope>
{/if}
