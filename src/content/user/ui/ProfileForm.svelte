<script lang="ts">
  /**
   * Встраиваемая форма редактирования профиля (`profileForm`) под защитой
   * `<Acl allow="user">`.
   *
   * Работает на любом маршруте и в модалке через `#hooks/component-form`:
   *   - гостю никогда не рендерится — `<Acl allow="user">` показывает экран входа;
   *   - без JS `Field` рисует штатный `FileField` с именованным файловым
   *     носителем `avatar`, отправляя исходный файл на серверный конвейер
   *     `prepareServerAvatar`;
   *   - с JS `FieldTakeover` (`base: FileField`) монтирует `AvatarTakeover`
   *     (компактный `FileAttachment` без имени/веса + сжатие `prepareAvatar` +
   *     запись готового `File` через `DataTransfer`). Никаких `base64`-строк
   *     по сети больше не передаётся.
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
  import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import { defaults } from '../config.js'
  import { createUserChecks } from '../checks.js'
  import type { AvatarLimits } from '../avatar.js'
  import { profileForm } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { hydrateVault, vault, type VaultPayload, type VaultProfile } from '../vault.svelte.js'
  import Acl from './Acl.svelte'
  import AvatarTakeover, { setAvatarTakeoverContext } from './AvatarTakeover.svelte'

  interface Props {
    /** Необязательное явное переопределение адреса экшена (по умолчанию — текущая страница). */
    action?: string
    /** Необязательный внешний результат (по умолчанию подхватывается из `page.data.formResult`). */
    form?: { result?: Result } | null
    /** Пределы конвейера аватара и проверок из конфига. */
    limits: AvatarLimits
    /** Текущий профиль для предзаполнения (редактирование); нет — из `vault`. */
    initial?: VaultProfile | null
    /** Явный признак авторизации (по умолчанию вычисляется из `vault` / `initial` / `page.data.user`). */
    authorized?: boolean
    /** Включён ли модуль пользователя на сервере (`AUTH_SEAL_SECRET`). */
    enabled?: boolean
    /** Куда ведёт «Отмена» без JS: `next` или назад. */
    doneHref?: string
    /** Успех сохранения или отмена (JS): закрыть модалку / перейти. */
    onDone?: () => void
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
  }: Props = $props()

  const notHydrated = useJsOnly()

  const isAuthorized = $derived(
    authorized !== undefined ? authorized : Boolean(vault.principal ?? initial),
  )

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
  })

  const seedProfile = untrack(() => initial ?? (vault.principal ? vault.profile : null))
  if (!bound.state.result) {
    mirrorToField(bound, 'nickname', () => seedProfile?.nickname ?? '')
  }

  const existingAvatar = $derived(initial?.avatarUrl ?? vault.profile.avatarUrl ?? seedProfile?.avatarUrl ?? null)
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

  // Успех сохранения: сервер отвечает шагом `done` — освежаем `vault` и вызываем `onDone`.
  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    const data = r.data as { step?: string; user?: VaultPayload } | undefined
    if (data?.step === 'done') {
      lastHandledSubmission = r.submissionId
      if (data.user) hydrateVault(data.user)
      onDone?.()
    }
  })
</script>

<Acl allow="user" authorized={isAuthorized} {enabled} backHref={doneHref}>
  <Form
    id="user-profile"
    form={bound}
    hiddenFields={bound.hidden()}
    class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left"
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
        <Button type="submit" name="intent" value="profile" task={formTask(bound.state)}>
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
