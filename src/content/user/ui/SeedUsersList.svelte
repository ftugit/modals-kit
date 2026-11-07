<script lang="ts">
  /**
   * Список seed-юзеров поверх `Listing`.
   *
   * Данные — один `load` роута `/users`. Страница отдаёт его пропсом `initial`;
   * модалка и шаг без `load` ничего не приносят — оболочка сама зовёт тот же
   * роут. Отказ (`fact`) уходит носителю через `onAcl`, `Acl` рисует он.
   *
   * Нажатие задаёт носитель фабрикой `rowAttrs`. По умолчанию — профиль.
   * Выбор красит `isSelected`. Срез `users.ids` переспрашивает первую порцию.
   */
  import { Listing } from '#components/listing/index.js'
  import { Skeleton } from '#components/paginator/index.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import SeedUserCard from './seed-users/SeedUserCard.svelte'
  import {
    ensureSeedUsersPaginator,
    SEED_USERS_EXTRA_DEFAULTS,
    SEED_USERS_FILTER_KEYS,
    SEED_USERS_NAME,
    SEED_USERS_PAGE_PARAM,
    SEED_USERS_PAGE_SIZE,
    type SeedUsersRouteData,
  } from './seed-users/source.js'

  interface Props {
    /** Данные `load` роута от носителя (страница/модалка): своего запроса не будет. */
    initial?: SeedUsersRouteData | null
    /**
     * Явный ключ изолированной области пагинатора (для немодальных стендов).
     * Внутри модалки область выделяется автоматически.
     */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресной строкой (`false` для `user.picker`). */
    url?: boolean
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (fact: AuthErrorCode) => void
    /** Механика строки. По умолчанию — профиль (`user.profile`, без JS — роут). */
    rowAttrs?: (user: SeedUserView) => LinkAttrs
    /** Оформление выбранных строк: смысл выбора — у механики носителя. */
    isSelected?: (id: string) => boolean
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    rowAttrs,
    isSelected,
    variant = 'plain',
    class: className,
  }: Props = $props()

  // Регистрация — в том же бандле, что и хост пагинатора внутри `Listing`.
  ensureSeedUsersPaginator()

  const asModalLink = useModalLink()
  const attrsOf = (user: SeedUserView): LinkAttrs =>
    rowAttrs?.(user) ?? { ...asModalLink('user.profile', { id: user.id }), title: 'Открыть профиль' }

  const nickOn = (extra: Record<string, unknown>) => extra.nick === '1'
</script>

<Listing
  name={SEED_USERS_NAME}
  pageParam={SEED_USERS_PAGE_PARAM}
  route="/users"
  watch="ids"
  loadError="auth.expired"
  ariaLabel="Список seed-юзеров"
  title="Seed-юзеры"
  {variant}
  class={className}
  {scope}
  {url}
  {initial}
  onAcl={onAcl ? (fact) => onAcl(fact as AuthErrorCode) : undefined}
  rowAttrs={attrsOf}
  {isSelected}
  rowTestId="seed-user-row"
  pendingTestId="seed-users-pending"
  actor={vault.principal}
  filters={{
    modal: 'user.list.filters',
    path: '/users/filters',
    keys: SEED_USERS_FILTER_KEYS,
    defaults: SEED_USERS_EXTRA_DEFAULTS,
    pageSize: SEED_USERS_PAGE_SIZE,
    testId: 'seed-users-filters-open',
  }}
  search={{
    label: (extra) => (nickOn(extra) ? 'Поиск по seed, id и никнейму' : 'Поиск по seed и id'),
    placeholder: (extra) =>
      nickOn(extra) ? 'Подстрока seed, id или никнейма…' : 'Подстрока seed или id…',
  }}
>
  {#snippet item(user, selected)}
    <SeedUserCard item={user} {selected} />
  {/snippet}
  {#snippet skeleton(extra)}
    <!--
      Скелетон повторяет геометрию строки, а не один серый блок.
      Блок никнейма — только при включённом параметре.
    -->
    <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="seed-user-skeleton">
      <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
      {#if nickOn(extra)}
        <span class="min-w-0 flex-1 basis-0" data-testid="seed-user-skeleton-nickname">
          <Skeleton class="h-3 w-full" />
        </span>
      {/if}
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
    </div>
  {/snippet}
</Listing>
