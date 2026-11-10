<script lang="ts">
  /**
   * Список своих устройств. Секретов строки (`jti`, версия) здесь нет:
   * сервер их не отдаёт. Хеш подсети показывается только коротким префиксом.
   * Блокировка — удержание и нативный POST на `/user/sessions`.
   */
  import { onMount } from 'svelte'
  import { asLink } from '#hooks/links/index.js'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { Badge, Button, Surface, TimeAgo } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { sessionRevokeOthersForm } from '../sessions.form.js'
  import type { SessionDeviceView, SessionsPage } from '../types.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import SessionRevokeForm from './SessionRevokeForm.svelte'

  interface Props {
    page: SessionsPage
    notice?: 'revoke-failed' | null
    variant?: UserSurfaceVariant
    class?: string
  }

  let { page, notice = null, variant = 'plain', class: className }: Props = $props()

  const others = $derived(page.total > (page.items.some((item) => item.current) ? 1 : 0))
  const totalPages = $derived(Math.max(1, Math.ceil(page.total / page.pageSize)))
  let now = $state(Date.now())
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })
  const items = $derived(
    [...page.items].sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt - a.createdAt),
  )
  const seesCurrent = $derived(page.items.some((item) => item.current))
  const othersForm = bind(forms, sessionRevokeOthersForm(), {
    action: '/user/sessions?/others',
    intercept: false,
  })

  function prefix(hash: string | null): string {
    if (!hash) return '—'
    return hash.slice(0, 8)
  }

  function statusOf(item: SessionDeviceView): string {
    if (item.deletedAt != null) return 'Завершена'
    if (item.expiresAt > 0 && item.expiresAt <= now) return 'Истекла'
    return 'Активна'
  }
</script>

<Surface
  {variant}
  class={cn('w-full', className)}
  title="Сессии"
  description="Ваши устройства. Текущая сессия отмечена. Блокировка завершает вход с этого устройства."
  data-testid="sessions-list"
>
  {#if notice === 'revoke-failed'}
    <p class="text-sm text-destructive" role="alert" data-testid="sessions-notice">
      Не удалось заблокировать сессию.
    </p>
  {/if}

  {#if page.items.length > 0 && !seesCurrent}
    <p class="text-sm text-muted-foreground" data-testid="sessions-current-missing">
      Текущая сессия в этом списке не показана.
    </p>
  {/if}

  {#if page.canRevoke && others}
    <Form form={othersForm} hiddenFields={othersForm.hidden()} class="mb-2 inline-flex">
      <div hidden>
        <Field of={othersForm.f.scope} />
      </div>
      <HoldButton type="submit" variant="outline" size="sm" seconds={2} data-testid="sessions-revoke-others">
        Заблокировать остальные
      </HoldButton>
    </Form>
  {/if}

  {#if page.items.length === 0}
    <p class="text-sm text-muted-foreground" data-testid="sessions-empty">Активных сессий нет.</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each items as item (item.id)}
        <li
          class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
          data-testid="session-row"
          data-id={item.id}
          data-current={item.current ? '' : undefined}
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{item.deviceName?.trim() || 'Без имени'}</span>
            {#if item.current}
              <Badge variant="secondary" size="sm">Это устройство</Badge>
            {/if}
            <Badge variant="outline" size="sm">{statusOf(item)}</Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            {item.country || 'Страна неизвестна'}
            · сеть {prefix(item.subnetHash)}
            {#if item.history.length > 1}
              · сеть менялась
            {/if}
            {#if item.lastSeenAt}
              · активность <TimeAgo value={item.lastSeenAt} />
            {:else}
              · активности ещё не было
            {/if}
          </p>
          {#if page.canRevoke && item.deletedAt == null}
            <SessionRevokeForm
              id={item.id}
              label={item.current ? 'Заблокировать это устройство' : 'Заблокировать'}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if totalPages > 1 || page.page > 1}
    <nav aria-label="Страницы сессий" class="mt-3 flex items-center gap-3" data-testid="sessions-pagination">
      {#if page.page > 1}
        <Button {...asLink(`/user/sessions?page=${page.page - 1}`)} variant="outline" size="sm">Назад</Button>
      {/if}
      <span class="text-sm">Страница {page.page} из {totalPages}</span>
      {#if page.page < totalPages}
        <Button {...asLink(`/user/sessions?page=${page.page + 1}`)} variant="outline" size="sm">Вперёд</Button>
      {/if}
    </nav>
  {/if}
</Surface>
