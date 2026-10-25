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
  import { Button } from '#components/ui/index.js'
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
    authorized,
    enabled,
    doneHref = '/',
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const notHydrated = useJsOnly()

  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  const activeProfile = $derived(vault.authorized ? vault.profile : (initial ?? vault.profile))

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

  const existingAvatar = $derived(activeProfile.avatarUrl ?? null)
  // Выбранный файл и флаг удаления — значения полей: карточка «Текущий аватар»
  // видна, только пока новое фото не выбрано и удаление не отмечено.
  const pickedPhoto = $derived(bound.f.photo.value)
  const removePhoto = $derived(bound.f.remove_photo.value)
  const showExisting = $derived(Boolean(existingAvatar) && !pickedPhoto && !removePhoto)

  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    const data = r.data as { step?: string; user?: VaultPayload } | undefined
    if (data?.step === 'done') {
      lastHandledSubmission = r.submissionId
      if (data.user) vault.hydrate(data.user)
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

    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Как вас показывать?</h2>
      <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
      <Field of={bound.f.nickname} />

      {#if showExisting}
        <!-- Текущее фото — отдельная карточка: в `input.files` его нет, туда
             попадает только выбранный файл. Выбрали новый — карточка уходит,
             выбранное показывает `FileAttachment` под полем. -->
        <div
          data-existing-avatar
          class="flex items-center gap-3 rounded-md border border-border/70 p-2"
        >
          <img src={existingAvatar} alt="" class="h-12 w-12 shrink-0 rounded object-cover" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm">Текущий аватар</span>
            <span class="text-xs text-muted-foreground">Выберите новый файл или удалите этот</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => bound.f.remove_photo.onInput(true)}
          >
            Удалить
          </Button>
        </div>
      {/if}

      <Field of={bound.f.photo} preview photoConvert={specAvatar} />

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
