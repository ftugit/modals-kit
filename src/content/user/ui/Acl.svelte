<script lang="ts" module>
  import { variants, type VariantProps } from '#components/utils.js'

  export const userSurfaceVariants = variants(
    '',
    {
      variant: {
        card: 'rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm',
        plain: '',
      },
    },
    { variant: 'card' },
  )

  export type UserSurfaceVariant = 'card' | 'plain'
  export type UserSurfaceProps = VariantProps<typeof userSurfaceVariants>
</script>

<script lang="ts">
  /**
   * UI ACL модуля пользователя в каноне shadcn/ui v4 (`Empty` + `Card`):
   * на отдельной странице (`variant="card"`) — спокойная карточка с нейтральной
   * рамкой `border-border`, внутри модалки (`variant="plain"`) — центрированное
   * состояние без вложенной рамки (поверхность и отступы `p-6` даёт сама модалка).
   *
   * Определяет, можно ли рендерить `children`, читая единый реактивный `vault`
   * (или явный булев override `authorized` на стендах/в тестах), а также
   * состояние подсистемы входа (`enabled`, `status`, `blocked`, `restrictions`)
   * и отказы моделей БД (`model`).
   */
  import type { Snippet } from 'svelte'
  import { useModalLink } from '#hooks/links/index.js'
  import { Badge, Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import {
    resolveAcl,
    type AclAllow,
    type AclModelInput,
  } from '../acl.js'
  import type { AuthErrorCode } from '../error.js'
  import { userAuthRoute } from '../routes.js'
  import type { Blocked } from '../types.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Кому разрешён просмотр содержимого (`'guest'`, `'user'` или список ролей). */
    allow?: AclAllow
    /** Явное переопределение флага авторизации (по умолчанию читается `vault.authorized`). */
    authorized?: boolean
    /** Роли текущего пользователя (если проверяются роли в `allow`). */
    roles?: readonly string[]
    /** Включён ли вход на сервере (`AUTH_SEAL_SECRET`). */
    enabled?: boolean
    /** Доменный код состояния сессии/аккаунта (`AuthErrorCode` или `'restrictions'`). */
    status?: AuthErrorCode | 'restrictions' | null
    /** Данные бана аккаунта (`scope: 'auth'`). */
    blocked?: { readonly reason: string; readonly untilMs: number | null } | null
    /** Активные ограничения действий пользователя (`scope !== 'auth'`). */
    restrictions?: readonly Blocked[] | null
    /** Отказ модели БД (`DbFailure` / `KitErrorBody` / `FailureKind`). */
    model?: AclModelInput
    /** Адрес возврата по умолчанию (для кнопки «На главную» / «Назад»). */
    backHref?: string
    /** Вариант поверхности (`'card'` — рамка карточки, `'plain'` — чистый блок без рамки). */
    variant?: UserSurfaceVariant
    /** Классы корневого блока (применяются через `cn`). */
    class?: string
    /** Слот своих кнопок действий на экране ACL (например, подтверждение «Принято»). */
    actions?: Snippet
    /** Защищаемое содержимое. */
    children?: Snippet
  }

  let {
    allow,
    authorized,
    roles,
    enabled,
    status = null,
    blocked = null,
    restrictions = null,
    model = null,
    backHref = '/',
    variant = 'card',
    class: className,
    actions,
    children,
  }: Props = $props()

  function optionalModalLink(): ReturnType<typeof useModalLink> | null {
    try {
      return useModalLink()
    } catch {
      return null
    }
  }

  const asModalLink = optionalModalLink()
  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)

  const screen = $derived(
    resolveAcl({
      allow,
      authorized: isAuthorized,
      roles,
      enabled,
      status,
      blocked,
      restrictions,
      model,
    }),
  )

  const loginLink = $derived(
    asModalLink
      ? asModalLink('user.auth')
      : { href: userAuthRoute.href() },
  )
  const restoreLink = $derived(
    asModalLink
      ? asModalLink('user.auth', { stage: 'restore' })
      : { href: userAuthRoute.href({ stage: 'restore' }) },
  )
</script>

{#if screen}
  <section
    data-acl-code={screen.code}
    data-acl-source={screen.source}
    data-acl-variant={variant}
    class={cn(
      'mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center',
      variant === 'plain' && 'my-auto',
      userSurfaceVariants({ variant }),
      className,
    )}
  >
    <div class="flex flex-col items-center gap-2">
      <span
        class={cn(
          'mb-1 flex size-10 shrink-0 items-center justify-center rounded-lg',
          screen.tone === 'destructive'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted text-foreground',
        )}
        aria-hidden="true"
      >
        {#if screen.code === 'not_found'}
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        {:else if screen.code === 'auth_required' || screen.code === 'session_expired'}
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        {:else}
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        {/if}
      </span>

      <h2 class="text-lg font-semibold leading-tight tracking-tight text-foreground">
        {screen.title}
      </h2>
      <p class="text-sm leading-relaxed text-muted-foreground text-balance">
        {screen.description}
      </p>
    </div>

    {#if screen.untilMs !== undefined}
      <Badge variant="outline">
        {screen.untilMs
          ? `До: ${new Date(screen.untilMs).toLocaleString('ru-RU')}`
          : 'Бессрочно'}
      </Badge>
    {/if}

    {#if screen.details?.length}
      <ul class="flex w-full flex-col gap-1.5 text-left text-sm">
        {#each screen.details as item, idx (idx)}
          <li class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {item}
          </li>
        {/each}
      </ul>
    {/if}

    {#if actions}
      <div class="w-full pt-1">
        {@render actions()}
      </div>
    {:else if screen.action === 'login'}
      <div class="w-full pt-1">
        <Button {...loginLink} class="w-full">Войти</Button>
      </div>
    {:else if screen.action === 'restore'}
      <div class="w-full pt-1">
        <Button {...restoreLink} class="w-full">Восстановить аккаунт</Button>
      </div>
    {:else if screen.action === 'back'}
      <div class="w-full pt-1">
        <Button href={backHref} variant="outline" class="w-full">На главную</Button>
      </div>
    {/if}
  </section>
{:else if children}
  {@render children()}
{/if}
