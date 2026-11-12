<script lang="ts">
  /**
   * Карточка одного устройства. Рисунок, не экран: носитель даёт `Surface`.
   *
   * Переименование — форма компонента: `device_name` единственное поле строки,
   * которое человек вправе менять. Отзыв — удержание и нативный POST на
   * `/user/sessions?/revoke`, тот же, что у списка. Секретов строки в карточке
   * нет: `jti` и версию сервер не отдаёт.
   */
  import { untrack } from 'svelte'
  import { asLink } from '#hooks/links/index.js'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { Badge, Button, TimeAgo } from '#components/ui/index.js'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { sessionRenameForm } from '../sessions.form.js'
  import type { SessionDetail } from '../types.js'
  import SessionRevokeForm from './SessionRevokeForm.svelte'

  interface Props {
    detail: SessionDetail
    /** Ошибка прошлой отправки: 'rename-failed' рисуется в карточке. */
    notice?: 'rename-failed' | null
    /** Момент отрисовки: статус считается без запроса. */
    now?: number
    /** Куда вернуться без JS после успеха/отказа. */
    backHref?: string
  }

  let { detail, notice = null, now = Date.now(), backHref = '/user/sessions' }: Props = $props()

  const session = $derived(detail.session)
  const status = $derived(
    session.deletedAt != null ? 'Завершена' : session.expiresAt > 0 && session.expiresAt <= now ? 'Истекла' : 'Активна',
  )
  const id = untrack(() => detail.session.id)
  const form = bind(forms, sessionRenameForm(id), {
    action: `/user/sessions/${id}?/rename`,
    intercept: false,
  })
</script>

<div class="flex flex-col gap-4" data-testid="session-card">
  {#if notice === 'rename-failed'}
    <p class="text-sm text-destructive" role="alert" data-testid="session-card-notice">
      Не удалось переименовать устройство.
    </p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <span class="text-base font-medium">{session.deviceName?.trim() || 'Без имени'}</span>
    {#if session.current}
      <Badge variant="secondary" size="sm">Это устройство</Badge>
    {/if}
    <Badge variant="outline" size="sm">{status}</Badge>
  </div>

  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="session-card-facts">
    <dt class="text-muted-foreground">Страна</dt>
    <dd>{session.country || 'Страна неизвестна'}</dd>
    <dt class="text-muted-foreground">Сеть</dt>
    <dd>{session.subnetHash ? session.subnetHash.slice(0, 8) : '—'}</dd>
    <dt class="text-muted-foreground">Создана</dt>
    <dd><TimeAgo value={session.createdAt} /></dd>
    <dt class="text-muted-foreground">Активность</dt>
    <dd>{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString('ru-RU') : 'Активности ещё не было'}</dd>
    <dt class="text-muted-foreground">Истекает</dt>
    <dd>{new Date(session.expiresAt).toLocaleString('ru-RU')}</dd>
  </dl>

  {#if session.history.length > 0}
    <div class="text-sm" data-testid="session-card-history">
      <p class="mb-1 text-muted-foreground">Прежние сети</p>
      <ul class="flex flex-col gap-1">
        {#each session.history as entry (entry.hash + ':' + entry.at)}
          <li class="text-xs">
            {entry.hash.slice(0, 8)} · {entry.country || 'страна неизвестна'} · {new Date(entry.at).toLocaleString('ru-RU')}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if detail.canRename}
    <Form form={form} hiddenFields={form.hidden()} class="flex flex-col gap-3" data-testid="session-rename-form">
      <div hidden>
        <Field of={form.f.id} />
      </div>
      <Field of={form.f.device_name} />
      <div class="flex items-center justify-between gap-3">
        <Button {...asLink(backHref)} variant="ghost" size="sm">К списку</Button>
        <Button type="submit" size="sm">Сохранить название</Button>
      </div>
    </Form>
  {/if}

  {#if detail.canRevoke && session.deletedAt == null}
    <div class="flex items-center justify-between gap-3 border-t border-border pt-3">
      <SessionRevokeForm
        id={session.id}
        label={session.current ? 'Заблокировать это устройство' : 'Заблокировать'}
        testId="session-card-revoke"
      />
      {#if detail.canHardDelete}
        <span class="text-xs text-muted-foreground">Полное удаление доступно администратору.</span>
      {/if}
    </div>
  {/if}
</div>
