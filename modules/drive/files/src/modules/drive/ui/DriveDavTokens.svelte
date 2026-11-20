<script lang="ts">
  /**
   * Пароли приложений WebDAV: список, выдача и отзыв — отдельные операции
   * (`drive.dav-issue`, `drive.dav-revoke`), а не формы на этом экране.
   *
   * Открытый секрет живёт только в POST-ответе своей операции и не попадает ни
   * в адрес, ни в снапшот: GET этой страницы его не выдаёт и не потребляет.
   */
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { Badge, Button } from '#core/ui/index.js'
  import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from '../operations.js'
  import { driveMessage } from '../messages.js'
  import type { DriveOperationData } from '../types.js'

  interface Props {
    initial: DriveOperationData
    /** Адрес этого экрана: куда вернётся POST без JS. По умолчанию `initial.returnTo`. */
    returnTo?: string
  }

  let { initial, returnTo = initial.returnTo }: Props = $props()

  const asModalLink = tryUseModals() ? useModalLink() : null
  const link = (op: DriveOperationName, extra: DriveOperationParams = {}) => {
    const params = { returnTo, ...extra }
    return asModalLink ? asModalLink(`drive.${op}`, params) : asLink(driveOperationHref(op, params))
  }

  const format = (value: Date | null) =>
    value
      ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(value)
      : '—'
</script>

<section class="flex min-w-0 flex-col gap-4" data-testid="drive-dav-tokens">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-sm text-muted-foreground">
      Пароль показывается один раз: в базе хранится только HMAC.
    </p>
    {#if initial.davEnabled}
      <Button {...link('dav-issue')} size="sm">Создать пароль</Button>
    {:else}
      <p class="text-sm text-destructive" role="status">{driveMessage('drive.dav-disabled')}</p>
    {/if}
  </div>

  {#if initial.davEnabled}
    <dl class="grid grid-cols-1 gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm sm:grid-cols-[auto_1fr]">
      <dt class="text-muted-foreground">Адрес</dt>
      <dd class="min-w-0 break-all font-mono text-xs">/api/dav/</dd>
      <dt class="text-muted-foreground">Логин</dt>
      <dd>любой</dd>
      <dt class="text-muted-foreground">Пароль</dt>
      <dd class="min-w-0 break-words">пароль приложения из списка ниже</dd>
    </dl>
  {/if}

  {#if initial.tokens.length === 0}
    <p class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      Паролей ещё нет. Пароль приложения нужен для подключения к диску по WebDAV.
    </p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each initial.tokens as token (token.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{token.label}</span>
              {#if token.revokedAt}
                <Badge variant="outline">отозван</Badge>
              {/if}
            </span>
            <span class="min-w-0 break-all font-mono text-xs text-muted-foreground">dv1_{token.prefix}_…</span>
            <span class="min-w-0 break-words text-xs text-muted-foreground">
              Создан {format(token.createdAt)} · использован {format(token.lastUsedAt)}
            </span>
          </div>
          {#if !token.revokedAt && initial.davEnabled}
            <Button
              {...link('dav-revoke', { tokenId: token.id })}
              variant="ghost"
              size="sm"
            >
              Отозвать
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
