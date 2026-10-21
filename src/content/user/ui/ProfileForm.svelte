<script lang="ts">
  /**
   * Шаг профиля после входа — ОТДЕЛЬНЫЙ компонент со своей формой
   * (`profileForm`) и своей привязкой: сессия уже есть, подпись не нужна,
   * приём на роуте различает формы по конверту. «Отмена» (пропуск) — НЕ
   * отправка: ссылка на `doneHref`, с JS клик перехватывает `onDone`
   * (закрытие модалки / переход виджета).
   *
   * Аватар — прежний клиентский конвейер (`prepareAvatar` → dataURL в
   * скрытое поле описания); замена на перехват поля (lib/image) — этап B+R2.
   */
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import type { Result } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button, FileInput } from '#lib/components/ui/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { prepareAvatar, type AvatarLimits } from '../avatar.js'
  import { profileForm } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'

  interface Props {
    /** Адрес экшена роута авторизации (страница или модалка). */
    action: string
    /** Результат экшена (без JS): continuation привязки. */
    form?: { result?: Result } | null
    /** Пределы конвейера аватара из конфига. */
    limits: AvatarLimits
    /** Куда ведёт «Отмена» без JS: next или домой. */
    doneHref: string
    /** Успех сохранения или пропуск (JS): закрыть/перейти — решает виджет. */
    onDone: () => void
  }

  let { action, form, limits, doneHref, onDone }: Props = $props()

  const notHydrated = useJsOnly()

  // Нативный POST обязан приземлиться на шаг профиля (load по `?stage=`):
  // адрес действия несёт шаг, иначе отказ без JS перерисует вход и ошибки
  // профиля никто не увидит. Транспорт (JS) ходит на голый адрес экшена.
  // svelte-ignore state_referenced_locally -- адрес постоянен за жизнь шага
  const bound = bind(forms, profileForm, {
    action: `${action}?stage=profile`,
    transport: kitActionTransport(action),
    continuation: untrack(() => form?.result ?? null),
  })

  // успех сохранения: сервер отвечает шагом done — дальше решает виджет
  let finished = false
  $effect(() => {
    const r = bound.state.result
    if (!finished && r?.ok && (r.data as { step?: string } | undefined)?.step === 'done') {
      finished = true
      onDone()
    }
  })

  /* ── аватар: конвейер с пределами из конфига; результат — скрытое поле ── */
  let avatarUrl = $state<string | null>(null)
  let avatarBusy = $state(false)
  let avatarError = $state<string | null>(null)
  // результат конвейера — значение поля avatar из описания (hidden):
  // зеркало кладёт его в состояние формы, HiddenField рисует сам носитель
  mirrorToField(bound, 'avatar', () => avatarUrl ?? '')

  async function onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const picked = input.files?.[0]
    if (!picked) return
    avatarBusy = true
    avatarError = null
    try {
      const outcome = await prepareAvatar(picked, limits)
      if (outcome.ok) avatarUrl = outcome.dataUrl
      else avatarError = AVATAR_TEXTS[outcome.code] ?? outcome.code
      if (!outcome.ok) input.value = ''
    } catch {
      avatarError = AVATAR_TEXTS['profile.avatar-format']
      input.value = ''
    } finally {
      avatarBusy = false
    }
  }

  // Только коды КЛИЕНТСКОГО конвейера аватара (они не форма-ошибки); тексты
  // доменных кодов живёт в `messages` формы — сервер наполняет message сам.
  const AVATAR_TEXTS: Record<string, string> = {
    'profile.avatar-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'profile.avatar-size': 'Картинка не сжимается до нужного веса — возьмите другую',
  }
</script>

<Form id="user-profile" form={bound} hiddenFields={bound.hidden()} class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left">
  <Common errors={bound.common} title="Проверьте форму" />

  {#if avatarError}
    <p role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{avatarError}</p>
  {/if}

  <div class="flex flex-col gap-3">
    <h2 class="text-base font-semibold">Как вас показывать?</h2>
    <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
    <Field of={bound.f.nickname} />
    <div class="space-y-1.5" data-field="avatar">
      <!-- носитель значения — скрытое поле описания, рисует lib/form;
           результат конвейера зеркалится в него из avatarUrl -->
      <Field of={bound.f.avatar} />
      <p class="text-sm">Аватар</p>
      {#if notHydrated()}
        <p class="text-xs text-muted-foreground">Файл {JS_ONLY_REASON} — без него сервер аватара не ждёт.</p>
      {:else}
        <!-- пикер — НЕ поле формы: имени нет, в FormData не попадает,
             до оживления в DOM не существует (виртуальная подмена).
             Круглый предпросмотр ниже — свой (ТЗ), preview пикера не нужен. -->
        <FileInput
          accept="image/jpeg,image/png,image/webp"
          onchange={onFileChange}
          disabled={avatarBusy}
        />
      {/if}
      {#if avatarUrl}
        <img src={avatarUrl} alt="Предпросмотр аватара" class="h-16 w-16 rounded-full object-cover" />
      {/if}
      {#if bound.f.avatar.errors[0]}
        <!-- ошибки сервера по аватару (скрытое поле свою ошибку не рисует):
             раньше гасились молча — владелец видел «ничего не происходит» (ход 261) -->
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
          e.preventDefault()
          onDone()
        }}>Отмена</Button>
    </div>
  </div>
</Form>
