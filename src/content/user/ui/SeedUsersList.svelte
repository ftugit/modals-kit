<script lang="ts">
  /**
   * Список seed-юзеров — конечный компонент, а не экран на подаче
   * носителя: он сам запрашивает данные и сам рисует всё своё
   * (заголовок, поиск, фильтры, строки, скелетоны, ожидание). Поэтому
   * он одинаково живёт на странице, в модалке и в шаге админки на
   * хосте шагов, где маршрутного `load` под него нет.
   *
   * Данные — одна точка: `load` роута `/users`. Страница отдаёт свой
   * серверный результат пропсом `initial` (SSR/no-JS целы); остальные
   * носители ничего не приносят — компонент при показе сам зовёт
   * `preloadData` того же роута, а порции догружает источник тем же
   * путём. ACL компонент не рисует: отказ (`fact`) сообщает носителю
   * через `onAcl`, носитель показывает `Acl`.
   *
   * Строки — в двух режимах, выбор снаружи: `link` (переход в профиль,
   * как было) и `select` (управляемый выбор юзера, например между
   * этапами: выбранный id и обработчик — пропсы, состояние выбора
   * живёт у вызывающего, не в списке).
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Paginator, SearchBar, Skeleton } from '#components/paginator/index.js'
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
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
    type SeedUsersRouteData,
  } from './seed-users/source.js'

  interface Props {
    /** Данные `load` роута от носителя (страница): своего запроса не будет. */
    initial?: SeedUsersRouteData | null
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (fact: AuthErrorCode) => void
    /** Режим строк: `link` — в профиль, `select` — выбор юзера наружу. */
    mode?: 'link' | 'select'
    /** Выбранный юзер в режиме `select` (состояние — снаружи). */
    selectedId?: string | null
    /** Выбор строки в режиме `select`. */
    onSelect?: (id: string) => void
    class?: string
  }

  let {
    initial = null,
    onAcl,
    mode = 'link',
    selectedId = null,
    onSelect,
    class: className,
  }: Props = $props()

  // Регистрация — на стороне компонента, в том же бандле, что и хост пагинатора.
  ensureSeedUsersPaginator()

  const asModalLink = useModalLink()

  let data = $state<SeedUsersRouteData | null>(untrack(() => initial))
  let asked = false

  $effect(() => {
    if (initial) {
      data = initial
      return
    }
    if (data || asked) return
    asked = true
    void (async () => {
      const r = await preloadData('/users')
      if (r.type !== 'loaded') {
        // Гостя увели редиректом на вход: носителю — сессионный отказ.
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as SeedUsersRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      data = d
    })()
  })

  const snapshot = $derived(data?.snapshot ?? null)

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

{#if snapshot}
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
        <SeedUserRow {item} {mode} selected={item.id === selectedId} {onSelect} />
      {/snippet}
      {#snippet renderSkeleton()}
        <!--
          Скелетон повторяет геометрию строки списка, а не один серый блок:
          те же сегменты, что у SeedUserRow. Блок никнейма — только при
          включённом параметре: выключен — у скелетона его нет, как нет
          столбца у настоящих строк.
        -->
        <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="seed-user-skeleton">
          <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
          {#if nickOn}
            <span class="min-w-0 flex-1 basis-0" data-testid="seed-user-skeleton-nickname">
              <Skeleton class="h-3 w-full" />
            </span>
          {/if}
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
        </div>
      {/snippet}
    </Paginator>
  </section>
  </PaginatorScope>
{:else}
  <!-- Собственное ожидание компонента: носителю скелет списка не положен. -->
  <section class={className} data-testid="seed-users-pending" aria-busy="true">
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="text-base font-semibold">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: —</span>
    </div>
    <div class="flex flex-col gap-2">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-9 w-full" />
      {/each}
    </div>
  </section>
{/if}
