<script lang="ts">
  /**
   * Встраиваемая форма редактирования профиля (`profileForm`).
   *
   * Привязана через `bindRouteForm`: где бы компонент ни монтировался
   * (`/user/profile`, модалка `user.profile`, пост-регистрационный шаг
   * `AuthWidget` или любая другая страница), его нативный `action` и JS-POST
   * ведут ровно на текущую страницу, а серверный `componentFormsHandle`
   * обрабатывает запрос и возвращает управление на ту же самую страницу.
   *
   * Аватар: компактный `FileAttachment` (только пикер и превью, без имени/веса
   * и без прогресс-бара) + клиентский конвейер `prepareAvatar` (`lib/image` →
   * `dataURL` в скрытое поле описания). Пока конвертация идёт, `f.pending`
   * удерживает отправку формы и перечитывает DOM после готовности результата.
   */
  import { tick, untrack } from 'svelte'
  import {
    Form,
    formTask,
    type FieldHandle,
    type FieldTakeover,
  } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type { Result } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Attachment, Button, FileAttachment } from '#lib/components/ui/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { prepareAvatar, type AvatarLimits } from '../avatar.js'
  import { profileForm } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { hydrateVault, vault, type VaultPayload, type VaultProfile } from '../vault.svelte.js'

  interface Props {
    /** Необязательное явное переопределение адреса экшена (по умолчанию — текущая страница). */
    action?: string
    /** Необязательный внешний результат (по умолчанию подхватывается из `page.data.formResult`). */
    form?: { result?: Result } | null
    /** Пределы конвейера аватара из конфига. */
    limits: AvatarLimits
    /** Текущий профиль для предзаполнения (редактирование); нет — из vault. */
    initial?: VaultProfile | null
    /** Куда ведёт «Отмена» без JS: next или назад. */
    doneHref?: string
    /** Успех сохранения или отмена (JS): закрыть модалку / перейти. */
    onDone?: () => void
  }

  let { action, form, limits, initial = null, doneHref = '/', onDone }: Props = $props()

  const notHydrated = useJsOnly()

  const bound = bindComponentForm(forms, profileForm, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
  })

  // предзаполнение редактирования: текущий профиль — из пропса (снимок
  // токена с сервера) или из vault вкладки. Никнейм сеется зеркалом (SSR —
  // синхронно); при продолжении отказа зеркало молчит — введённое важнее.
  // Аватар только показываем: в поле едет лишь заново выбранный, пустое
  // поле сервер читает как «не трогать»
  const seedProfile = untrack(() => initial ?? (vault.principal ? vault.profile : null))
  if (!bound.state.result) {
    mirrorToField(bound, 'nickname', () => seedProfile?.nickname ?? '')
  }
  const existingAvatar = seedProfile?.avatarUrl ?? null

  // успех сохранения: сервер отвечает шагом done — освежаем vault и вызываем onDone
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

  /* ── аватар: конвейер с пределами из конфига + задержка submit через f.pending ── */
  let avatarFiles = $state<FileList | undefined>(undefined)
  let avatarUrl = $state<string | null>(null)
  let avatarBusy = $state(false)
  let avatarHandle: FieldHandle | null = null
  let activeAbort: AbortController | null = null

  const hasPickedFile = $derived(Boolean(avatarFiles && avatarFiles.length > 0))

  // результат конвейера — значение поля avatar из описания (hidden):
  // зеркало кладёт его в состояние формы, HiddenField рисует сам носитель
  mirrorToField(bound, 'avatar', () => avatarUrl ?? '')

  const avatarTakeover: FieldTakeover = (f) => {
    avatarHandle = f
    return {
      dispose: () => {
        activeAbort?.abort()
        activeAbort = null
        avatarHandle = null
      },
    }
  }

  function onFileChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const picked = input.files?.[0]

    activeAbort?.abort()
    activeAbort = null

    if (!picked) {
      avatarUrl = null
      avatarBusy = false
      if (avatarHandle) {
        avatarHandle.pending = undefined
        avatarHandle.error = undefined
      }
      return
    }

    const controller = new AbortController()
    activeAbort = controller
    avatarBusy = true
    if (avatarHandle) avatarHandle.error = undefined

    const job = (async () => {
      try {
        const outcome = await prepareAvatar(picked, limits, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (outcome.ok) {
          avatarUrl = outcome.dataUrl
          await tick()
        } else {
          avatarUrl = null
          avatarFiles = undefined
          input.value = ''
          await tick()
          if (avatarHandle) avatarHandle.error = { code: outcome.code }
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        avatarUrl = null
        avatarFiles = undefined
        input.value = ''
        await tick()
        if (avatarHandle) avatarHandle.error = { code: 'profile.avatar-format' }
      } finally {
        if (activeAbort === controller) {
          activeAbort = null
          avatarBusy = false
        }
      }
    })()

    if (avatarHandle) avatarHandle.pending = job
  }
</script>

<Form id="user-profile" form={bound} hiddenFields={bound.hidden()} class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left">
  <Common errors={bound.common} title="Проверьте форму" />

  <div class="flex flex-col gap-3">
    <h2 class="text-base font-semibold">Как вас показывать?</h2>
    <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
    <Field of={bound.f.nickname} />
    <div class="space-y-1.5" data-field="avatar">
      <!-- носитель значения — скрытое поле описания; takeover подключает
           живую ручка поля (f.pending задерживает отправку до конца конвертации) -->
      <Field of={bound.f.avatar} takeover={avatarTakeover} />
      <p class="text-sm">Аватар</p>
      {#if notHydrated()}
        <p class="text-xs text-muted-foreground">Файл {JS_ONLY_REASON} — без него сервер аватара не ждёт.</p>
      {:else}
        <FileAttachment
          bind:files={avatarFiles}
          accept="image/jpeg,image/png,image/webp"
          size="sm"
          layout="tile"
          attachmentSize="sm"
          media="image"
          showFilename={false}
          showSize={false}
          onchange={onFileChange}
          disabled={avatarBusy}
        />
      {/if}
      {#if !hasPickedFile && existingAvatar}
        <Attachment
          previewUrl={existingAvatar}
          alt="Аватар"
          layout="tile"
          size="sm"
          media="image"
          showFilename={false}
          showSize={false}
        />
      {/if}
      {#if bound.f.avatar.errors[0]}
        <p role="alert" class="text-xs font-medium text-destructive">{bound.f.avatar.errors[0].message}</p>
      {/if}
    </div>
    <div class="flex items-center justify-between gap-2">
      <!-- «Сохранить» слева, «Отмена» справа (ТЗ). Отмена — ссылка, не отправка:
           без JS честно ведёт дальше, с JS клик перехватывает onDone -->
      <Button type="submit" name="intent" value="profile" task={formTask(bound.state)}>Сохранить</Button>
      <Button
        href={doneHref}
        variant="ghost"
        onclick={(e: MouseEvent) => {
          if (!onDone) return
          e.preventDefault()
          onDone()
        }}>Отмена</Button>
    </div>
  </div>
</Form>
