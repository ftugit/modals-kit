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
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { invalidateProfileReads } from '../../profile-reads.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type { Result } from '#lib/form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button, type AttachmentItem } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useJsOnly } from '#hooks/js-only.svelte.js'
  import { createUserChecks } from '../../checks.js'
  import { specAvatar } from '../../spec-avatar.js'
  import { userSession, vault, type VaultPayload, type VaultProfile } from '../../vault.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from '../Acl.svelte'
  import { profileForm } from './form.js'

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
    authorized,
    enabled,
    doneHref = '/',
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const notHydrated = useJsOnly()

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

  const modalsCtx = tryUseModals()

  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    const data = r.data as { step?: string; user?: VaultPayload } | undefined
    if (data?.step === 'done') {
      lastHandledSubmission = r.submissionId
      if (data.user) vault.hydrate(data.user)
      // Запись профиля видна из кешей чтения (модалка профиля, список,
      // маршрутные load, ячейка пагинатора): сами они о мутации не узнают
      // и до перезагрузки страницы показывали бы «профиль не создан».
      const nickname = String(bound.f.nickname.value ?? '').trim()
      invalidateProfileReads({
        modals: modalsCtx?.modals ?? null,
        subjectId: subject ?? vault.principal,
        nickname: nickname === '' ? undefined : nickname,
      })
      onDone?.()
    }
  })
</script>

<Acl
  allow="user"
  authorized={isAuthorized}
  {enabled}
  backHref={doneHref}
  {variant}
  class={className}
>
  <Form
    id="user-profile"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn(
      'mx-auto flex w-full max-w-sm flex-col gap-4 text-left',
      userSurfaceVariants({ variant }),
      className,
    )}
  >
    <Common errors={bound.common} title="Проверьте форму" />

    <!-- Чей профиль: пусто — свой (заполняется `mirrorToField` выше) -->
    <div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>

    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Как вас показывать?</h2>
      <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
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

      <div class="flex items-center justify-between gap-2">
        <Button type="submit" name="intent" value="profile" task={formTask(bound.state, 'profile')}>
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
</Acl>
