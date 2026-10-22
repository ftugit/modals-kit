<script lang="ts">
  /**
   * UI ACL модуля пользователя.
   *
   * Определяет, можно ли рендерить `children`, исходя из:
   *   - статуса авторизации субъекта (`allow: 'guest' | 'user' | readonly string[]`,
   *     автоматически синхронизируется с SSR `page.data.user` и клиентским `vault`);
   *   - состояния аккаунта / подсистемы входа (`enabled`, `status`, `blocked`, `restrictions`);
   *   - срабатывания модели БД (`model`: `DbFailure` / `KitErrorBody` / `FailureKind`).
   *
   * Если ограничение сработало — вместо `children` показывает соответствующий экран ACL.
   */
  import type { Snippet } from 'svelte'
  import { page } from '$app/state'
  import { useModalLink } from '#lib/components/links/index.js'
  import { Button } from '#lib/components/ui/index.js'
  import {
    resolveAcl,
    type AclAllow,
    type AclModelInput,
  } from '../acl.js'
  import type { AuthErrorCode } from '../error.js'
  import type { Blocked } from '../types.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Кому разрешён просмотр содержимого (`'guest'`, `'user'` или список ролей). */
    allow?: AclAllow
    /** Явное переопределение флага авторизации (по умолчанию берётся из `vault` / `page.data.user`). */
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

  const isAuthorized = $derived(
    authorized !== undefined
      ? authorized
      : Boolean(vault.principal ?? (page.data as { user?: unknown } | undefined)?.user),
  )

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
    asModalLink ? asModalLink('user.auth', {}, { href: '/user/auth' }) : { href: '/user/auth' },
  )
  const restoreLink = $derived(
    asModalLink
      ? asModalLink('user.auth', { stage: 'restore' }, { href: '/user/auth?stage=restore' })
      : { href: '/user/auth?stage=restore' },
  )
</script>

{#if screen}
  <section
    data-acl-code={screen.code}
    data-acl-source={screen.source}
    class="mx-auto flex w-full max-w-sm flex-col gap-3 rounded-xl border p-4 text-left {screen.tone ===
    'destructive'
      ? 'border-destructive/40 bg-card'
      : screen.tone === 'warning'
        ? 'border-border bg-card'
        : 'border-border bg-card'}"
  >
    <h2
      class="text-base font-semibold {screen.tone === 'destructive'
        ? 'text-destructive'
        : 'text-foreground'}"
    >
      {screen.title}
    </h2>
    <p class="text-sm text-muted-foreground">{screen.description}</p>

    {#if screen.untilMs !== undefined}
      <p class="text-xs text-muted-foreground">
        {screen.untilMs
          ? `До: ${new Date(screen.untilMs).toLocaleString()}`
          : 'Бессрочно'}
      </p>
    {/if}

    {#if screen.details?.length}
      <ul class="space-y-1.5 text-sm">
        {#each screen.details as item, idx (idx)}
          <li class="rounded-md border border-border px-3 py-2 text-xs text-foreground">
            {item}
          </li>
        {/each}
      </ul>
    {/if}

    {#if actions}
      <div class="pt-1">
        {@render actions()}
      </div>
    {:else if screen.action === 'login'}
      <div class="pt-1">
        <Button {...loginLink} variant="outline" class="w-full">Войти</Button>
      </div>
    {:else if screen.action === 'restore'}
      <div class="pt-1">
        <Button {...restoreLink} variant="outline" class="w-full">Восстановить аккаунт</Button>
      </div>
    {:else if screen.action === 'back'}
      <div class="pt-1">
        <Button href={backHref} variant="outline" class="w-full">На главную</Button>
      </div>
    {/if}
  </section>
{:else if children}
  {@render children()}
{/if}
