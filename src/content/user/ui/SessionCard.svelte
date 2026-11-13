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
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useSteps } from '#components/steps/index.js'
  import { asLink } from '#hooks/links/index.js'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Badge, Button, TimeAgo } from '#components/ui/index.js'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { sessionRenameForm } from '../sessions.form.js'
  import { userAccountSessionRoute, userAccountSessionsRoute, userSessionRoute, userSessionsRoute } from '../routes.js'
  import type { SessionDetail } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import ExitSteps from './sessions-list/ExitSteps.svelte'

  interface Props {
    detail: SessionDetail
    /** Ошибка прошлой отправки: 'rename-failed' рисуется в карточке. */
    notice?: 'rename-failed' | null
    /** Момент отрисовки: статус считается без запроса. */
    now?: number
    /** Куда вернуться без JS после успеха/отказа. */
    backHref?: string
    /** Носитель: страница — шаг в URL, модалка — локальный хост шагов. */
    mode?: 'page' | 'modal'
    /** Абсолютный POST-адрес переименования своей единицы; по умолчанию — из реестра по аккаунту строки. */
    actionHref?: string
  }

  let { detail, notice = null, now = Date.now(), backHref = '/user/sessions', mode = 'page', actionHref }: Props = $props()

  const session = $derived(detail.session)
  const status = $derived(
    session.deletedAt != null ? 'Завершена' : session.expiresAt > 0 && session.expiresAt <= now ? 'Истекла' : 'Активна',
  )
  const id = untrack(() => detail.session.id)

  // Закрыть карточку — тот же набор, что и в списке: `only ids=[эта строка]`.
  // Свою текущую сессию здесь не закрывают вовсе: для неё есть выход в меню,
  // а две кнопки с одним смыслом в разных местах расходятся поведением.
  const stepsMode = untrack(() => mode)
  const exitKey = 'session.exit'
  const exitHost = useSteps({
    owner: 'user-session-exit',
    key: exitKey,
    mode: stepsMode === 'modal' ? 'local' : 'url',
    steps: () => [
      { key: 'summary', label: 'Сводка', filled: true },
      { key: 'confirm', label: 'Подтверждение', filled: true },
    ],
    current: () =>
      stepsMode === 'modal'
        ? 'summary'
        : visibleAddress().url.searchParams.get(exitKey) === 'confirm'
          ? 'confirm'
          : 'summary',
  })
  const exitStep = $derived(exitHost.currentKey === 'confirm' ? 'confirm' : 'summary')
  const cardRoute = $derived(
    session.authId && session.authId !== vault.principal
      ? userAccountSessionRoute.href({ id: session.authId, sessionId: id })
      : userSessionRoute.href({ id }),
  )
  const exitNextHref = $derived(stepsMode === 'modal' ? `${cardRoute}?${exitKey}=confirm` : exitHost.href('confirm'))
  const exitBackHref = $derived(stepsMode === 'modal' ? cardRoute : exitHost.blankHref())
  const closable = $derived(detail.canRevoke && session.deletedAt == null && !session.current)
  // Цель отзыва — аккаунт строки, а не зрителя: чужая сессия закрывается
  // экшеном чужого списка, иначе набор не найдёт её в своём аккаунте.
  const foreign = $derived(Boolean(session.authId && session.authId !== vault.principal))
  const exitAction = $derived(
    foreign ? `${userAccountSessionsRoute.href({ id: session.authId! })}?/others` : `${userSessionsRoute.href()}?/others`,
  )
  // Переименование уходит на экшен своей единицы: чужая строка — на чужой
  // роут, поэтому `actions.rename` чужой страницы достижим и не удаляется.
  const renameAction = $derived(
    actionHref ??
      (foreign
        ? `${userAccountSessionRoute.href({ id: session.authId!, sessionId: id })}?/rename`
        : `${userSessionRoute.href({ id })}?/rename`),
  )
  const form = bind(forms, sessionRenameForm(id), {
    action: untrack(() => renameAction),
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

  {#if closable}
    <div class="flex flex-col gap-3 border-t border-border pt-3">
      {#if exitStep === 'confirm'}
        <ExitSteps
          ids={[id]}
          pick="only"
          step="confirm"
          action={exitAction}
          backHref={exitBackHref}
          onBack={stepsMode === 'modal' ? () => exitHost.set('summary') : undefined}
          heading="Завершение сессии"
          summary="Устройство потеряет доступ: войти придётся заново."
          confirmLabel="Завершить сессию"
          testId="session-card-exit"
        />
      {:else}
        <div class="flex items-center justify-between gap-3">
          {#if stepsMode === 'modal'}
            <Button type="button" onclick={() => exitHost.set('confirm')} variant="outline" size="sm" data-testid="session-card-revoke">
              Заблокировать
            </Button>
          {:else}
            <Button href={exitNextHref} variant="outline" size="sm" data-testid="session-card-revoke">
              Заблокировать
            </Button>
          {/if}
          {#if detail.canHardDelete}
            <span class="text-xs text-muted-foreground">Полное удаление доступно администратору.</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
