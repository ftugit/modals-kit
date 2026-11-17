<script lang="ts">
  /**
   * Пароли приложений WebDAV: выдача, одноразовый показ секрета, список и
   * отзыв. Формы нативные: работают и без JS, ответ — 303 обратно на экран.
   */
  import { untrack } from 'svelte'
  import CopyInput from '#core/ui/copy-input/CopyInput.svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Badge, Button } from '#core/ui/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import { driveDavIssueForm, driveDavRevokeForm } from '../form.js'
  import { driveMessage } from '../messages.js'
  import type { DriveDavTokensData } from '../types.js'

  interface Props {
    initial: DriveDavTokensData
    /** Куда уходят POST-формы (`/user/config/dav`). */
    actionBase: string
    returnTo: string
  }

  let { initial, actionBase, returnTo }: Props = $props()

  const init = untrack(() => ({ actionBase, returnTo }))
  const issue = bind(forms, driveDavIssueForm(init.returnTo), {
    action: `${init.actionBase}?/issue`,
    instance: 'drive:dav-issue',
    intercept: false,
  })
  const revokeForms = $derived(
    new Map(
      initial.tokens
        .filter((token) => token.revokedAt === null)
        .map((token) => [
          token.id,
          bind(forms, driveDavRevokeForm(token.id, init.returnTo), {
            action: `${init.actionBase}?/revoke`,
            instance: `drive:dav-revoke-${token.id.slice(0, 8)}`,
            intercept: false,
          }),
        ]),
    ),
  )
  const format = (value: Date | null) =>
    value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(value) : '—'
</script>

<section class="flex flex-col gap-4" data-testid="drive-dav-tokens">
  {#if initial.notice}
    <p class="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
      {driveMessage(initial.notice)}
    </p>
  {/if}

  {#if initial.issued}
    <div class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4" data-testid="drive-dav-issued">
      <p class="text-sm font-medium">Пароль создан</p>
      <p class="text-xs text-muted-foreground">
        Скопируйте его сейчас: сервер хранит только HMAC, повторно пароль не покажется.
      </p>
      <CopyInput value={initial.issued} readonly aria-label="Пароль приложения WebDAV" />
    </div>
  {/if}

  {#if !initial.enabled}
    <p class="rounded-lg border border-border p-3 text-sm text-muted-foreground" data-testid="drive-dav-disabled">
      {driveMessage('drive.dav-disabled')}
    </p>
  {:else}
    <Form form={issue} hiddenFields={issue.hidden()} class="flex flex-wrap items-end gap-2">
      <Field of={issue.f.return_to} />
      <div class="min-w-48 flex-1"><Field of={issue.f.label} /></div>
      <Button type="submit" size="sm">Создать пароль</Button>
    </Form>
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
            <span class="font-mono text-xs text-muted-foreground">dv1_{token.prefix}_…</span>
            <span class="text-xs text-muted-foreground">
              Создан {format(token.createdAt)} · использован {format(token.lastUsedAt)}
            </span>
          </div>
          {#if revokeForms.get(token.id)}
            {@const revoke = revokeForms.get(token.id)!}
            <Form form={revoke} hiddenFields={revoke.hidden()} class="inline">
              <Field of={revoke.f.return_to} />
              <Field of={revoke.f.token_id} />
              <Button type="submit" variant="ghost" size="sm">Отозвать</Button>
            </Form>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
