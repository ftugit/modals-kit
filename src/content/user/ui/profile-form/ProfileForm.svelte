<script lang="ts">
  /**
   * Встраиваемая форма редактирования профиля (`profileForm`) под защитой
   * `<Acl allow="user">`.
   *
   * Читает и обновляет профиль через единый реактивный `vault`.
   */
  import { untrack } from 'svelte'
  import { Form, formTask, type FieldTakeover } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type { Result } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import FileField from '#lib/components/form/FileField.svelte'
  import Field from '#lib/components/form/Field.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import { cn } from '#lib/utils.js'
  import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import { defaults } from '../../config.js'
  import { createUserChecks } from '../../checks.js'
  import { userSession, vault, type VaultPayload, type VaultProfile } from '../../vault.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from '../Acl.svelte'
  import type { AvatarLimits } from './avatar.js'
  import { profileForm } from './form.js'
  import AvatarTakeover, { setAvatarTakeoverContext } from './AvatarTakeover.svelte'

  interface Props {
    action?: string
    form?: { result?: Result } | null
    limits: AvatarLimits
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
    limits,
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

  const initialLimits = untrack(() => limits)
  const userChecks = createUserChecks({
    nicknameForbidden: initialLimits.nicknameForbidden ?? defaults.nicknameForbidden,
    avatarEdge: initialLimits.edge,
    avatarMaxBytes: initialLimits.maxBytes,
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
  const removeCurrent = $derived(Boolean(bound.state.values.remove_avatar))

  setAvatarTakeoverContext({
    limits: () => limits,
    existingAvatar: () => existingAvatar,
    removeCurrent: () => removeCurrent,
    onRemoveCurrent: () => {
      bound.f.remove_avatar.onInput(true)
    },
  })

  const avatarTakeover: FieldTakeover = () => ({
    base: FileField,
    view: AvatarTakeover,
  })

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

      <Field of={bound.f.avatar} takeover={avatarTakeover} />

      {#if existingAvatar}
        {#if notHydrated()}
          <Field of={bound.f.remove_avatar} />
        {:else}
          <div hidden aria-hidden="true"><Field of={bound.f.remove_avatar} /></div>
        {/if}
      {:else}
        <div hidden aria-hidden="true"><Field of={bound.f.remove_avatar} /></div>
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
