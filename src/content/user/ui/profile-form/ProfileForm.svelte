<script lang="ts" module>
  import { defaults } from '../../config.js'

  /** Настройки экрана профиля: только никнейм. Всё про файл — у поля и примитива. */
  export interface ProfileLimits {
    readonly nicknameForbidden: readonly string[]
  }

  /** Умолчания экрана профиля — из конфига модуля. */
  export const DEFAULT_PROFILE_LIMITS: ProfileLimits = {
    nicknameForbidden: defaults.nicknameForbidden,
  }
</script>

<script lang="ts">
  /** Пустой чужой профиль: строки ещё нет — поля показываем с нулями. */
  const emptyProfile: VaultProfile = { nickname: null, avatarUrl: null }

  /**
   * Встраиваемая форма редактирования профиля (`profileForm`) под защитой
   * `<Acl allow="user">`.
   *
   * Читает и обновляет профиль через единый реактивный `vault`.
   *
   * Картинка профиля — обычное поле файла: `preview` включает гибрид (выбранное
   * видно), `photoConvert` передаёт параметры приведения примитиву. Параметры —
   * `specAvatar` и только он: это набор параметров, а не механизм.
   */
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type { Result } from '#lib/form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button, Surface, type AttachmentItem } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useJsOnly } from '#hooks/js-only.svelte.js'
  import { createUserChecks } from '../../checks.js'
  import { specAvatar } from '../../spec-avatar.js'
  import { userSession, vault, type VaultPayload, type VaultProfile } from '../../vault.svelte.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import Acl, { type UserSurfaceVariant } from '../Acl.svelte'
  import { profileForm } from './form.js'
  import { syncProfileAccess } from './sync-access.js'

  interface Props {
    action?: string
    form?: { result?: Result } | null
    limits?: ProfileLimits
    initial?: VaultProfile | null
    /**
     * Чей профиль: пусто — свой, иначе id аккаунта. Компонент не решает, можно
     * ли править чужое — это делает сервер (право `profile.edit`/`admin`), и
     * значения такого профиля приходят в `initial` (свой берётся из `vault`).
     */
    subject?: string | null
    /**
     * id цели, которую вызывающий вправе удалить: кнопка «Удалить» справа
     * сверху ведёт на пару `user.profile.delete`. Пусто — кнопки нет (так
     * же нет её при запрете удаления на цели: флаг считает чтение).
     */
    deleteId?: string | null
    authorized?: boolean
    enabled?: boolean
    doneHref?: string
    onDone?: () => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    action,
    form,
    limits = DEFAULT_PROFILE_LIMITS,
    initial = null,
    subject = null,
    deleteId = null,
    authorized,
    enabled,
    doneHref = '/',
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const notHydrated = useJsOnly()
  const asModalLink = useModalLink()

  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  /**
   * Чужой профиль показываем ровно тем, что дал сервер (`initial`): `vault`
   * — про себя, и подставлять его значения в чужую форму нельзя.
   */
  const foreign = $derived(Boolean(subject))
  const activeProfile = $derived(
    foreign ? (initial ?? emptyProfile) : vault.authorized ? vault.profile : (initial ?? vault.profile),
  )

  const userChecks = createUserChecks({
    nicknameForbidden: untrack(() => limits.nicknameForbidden) ?? defaults.nicknameForbidden,
  })

  const bound = bindComponentForm(forms, profileForm, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    checks: userChecks,
    session: userSession,
  })

  if (!bound.state.result) {
    mirrorToField(bound, 'nickname', () => activeProfile.nickname ?? '')
  }
  // Адрес правимого профиля уезжает скрытым полем: пусто — свой
  mirrorToField(bound, 'subject', () => subject ?? '')

  const existingAvatar = $derived(activeProfile.avatarUrl ?? null)
  // Снятый аватар — значение поля `remove_photo`: снятое не показываем.
  // Замена на выбранный файл — режим `replace` самого поля, не форма.
  const removePhoto = $derived(bound.f.remove_photo.value)
  const avatarItems = $derived<AttachmentItem[]>(
    existingAvatar && !removePhoto
      ? [{ id: 'avatar', filename: 'Текущий аватар', kind: 'image', previewUrl: existingAvatar }]
      : [],
  )

  let lastHandledSubmission = ''
  let syncPending = $state(false)
  let syncFailed = $state(false)
  let syncController: AbortController | undefined
  let syncSubject: string | null = null

  $effect(() => () => syncController?.abort())

  async function finishOwnProfile(): Promise<void> {
    if (syncPending || !syncSubject) return
    const expected = syncSubject
    syncPending = true
    syncFailed = false
    const controller = new AbortController()
    syncController = controller
    try {
      const url = visibleAddress().url
      const user = await syncProfileAccess(url.pathname + url.search, expected, controller.signal)
      if (controller.signal.aborted) return
      if (!user || vault.principal !== expected) {
        syncFailed = true
        return
      }
      vault.hydrate(user)
      onDone?.()
    } catch {
      if (!controller.signal.aborted) syncFailed = true
    } finally {
      if (syncController === controller) syncController = undefined
      if (!controller.signal.aborted) syncPending = false
    }
  }

  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    const data = r.data as { step?: string; user?: VaultPayload } | undefined
    if (data?.step === 'done') {
      lastHandledSubmission = r.submissionId
      if (foreign && subject !== vault.principal) {
        onDone?.()
        return
      }
      // Профиль уже сохранён. HTTP-синхронизация нужна до перехода: cookie,
      // выставленная сервером при WS-загрузке, не доходит через WebSocket.
      if (data.user) vault.hydrate(data.user)
      syncSubject = data.user?.sub ?? vault.principal
      if (syncSubject) void finishOwnProfile()
      else syncFailed = true
    }
  })
</script>

{#snippet profileDelete()}
  {#if deleteId}
    <!-- Удаление — отдельная пара по праву (флаг посчитало чтение);
         сервер при отправке права и запреты перепроверит. -->
    <a
      {...asModalLink('user.profile.delete', { id: deleteId })}
      class="shrink-0 rounded-md px-2 py-1 text-sm text-destructive underline-offset-4 hover:underline"
      data-testid="profile-delete-link"
    >
      Удалить
    </a>
  {/if}
{/snippet}

{#snippet profileHint()}
  <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
{/snippet}

<Acl
  allow="user"
  authorized={isAuthorized}
  {enabled}
  backHref={doneHref}
  {variant}
  class={className}
>
  <Surface
    {variant}
    class={cn('mx-auto w-full max-w-sm', className)}
    title={foreign ? 'Профиль пользователя' : 'Как вас показывать?'}
    description={foreign ? undefined : profileHint}
    controls={deleteId ? profileDelete : undefined}
  >
  <Form
    id="user-profile"
    form={bound}
    hiddenFields={bound.hidden()}
    class="flex flex-col gap-4 text-left"
  >
    <Common errors={bound.common} title="Проверьте форму" />

    <!-- Чей профиль: пусто — свой (заполняется `mirrorToField` выше) -->
    <div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>

    <div class="flex flex-col gap-3">
      <Field of={bound.f.nickname} />

      <Field
        of={bound.f.photo}
        preview
        photoConvert={specAvatar}
        items={avatarItems}
        onremove={() => bound.f.remove_photo.onInput(true)}
      />

      {#if existingAvatar && notHydrated()}
        <Field of={bound.f.remove_photo} />
      {:else}
        <div hidden aria-hidden="true"><Field of={bound.f.remove_photo} /></div>
      {/if}

      {#if syncPending}
        <p role="status" class="text-sm">Профиль сохранён, обновляем сессию…</p>
      {:else if syncFailed}
        <div role="alert" class="text-sm">
          Профиль сохранён, но обновить сессию не удалось.
          <Button type="button" variant="ghost" onclick={() => void finishOwnProfile()}>Повторить обновление</Button>
        </div>
      {/if}
      <div class="flex items-center justify-between gap-2">
        <Button type="submit" name="intent" value="profile" disabled={syncPending || syncFailed} task={formTask(bound.state, 'profile')}>
          Сохранить
        </Button>
        <Button
          href={doneHref}
          variant="ghost"
          onclick={(e: MouseEvent) => {
            if (!onDone) return
            e.preventDefault()
            onDone()
          }}
        >
          Отмена
        </Button>
      </div>
    </div>
  </Form>
  </Surface>
</Acl>
