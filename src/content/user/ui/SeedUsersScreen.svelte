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
   */
  import { Paginator } from '#components/paginator/index.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import SeedUserRow from './seed-users/SeedUserRow.svelte'
  import { ensureSeedUsersPaginator, SEED_USERS_NAME } from './seed-users/source.js'

  interface Props {
    snapshot: PaginatorState<SeedUserView> | null
    fact: AuthErrorCode | null
    enabled?: boolean
    variant?: UserSurfaceVariant
    class?: string
  }

  let { snapshot, fact, enabled, variant = 'plain', class: className }: Props = $props()

  // Регистрация — на стороне экрана, в том же бандле, что и хост пагинатора.
  ensureSeedUsersPaginator()
</script>

{#if fact === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" {variant} class={className} />
{:else if fact}
  <Acl status={fact} backHref="/" {variant} class={className} />
{:else if snapshot}
  <section class={className}>
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="text-base font-semibold">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: {snapshot.totalItems ?? '—'}</span>
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
{/if}
