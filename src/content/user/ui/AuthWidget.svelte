<script lang="ts">
  /**
   * Виджет авторизации — ОДНА форма (`authForm`), шаги различает интент:
   * вход/создание → восстановление → профиль → блокировка → ограничения.
   * Отправка — штатный путь `lib/form`: `bind` + `Form` (raw form-теги в
   * роутах запрещены), транспорт — fetch на экшен с accept: application/json;
   * без JS нативный POST — тот же экшен, шаг приезжает в `form.result.data`.
   *
   * Подпись nonce — в транспорте (место сетевого вызова): перед отправкой
   * секретом из поля подписывается живой nonce. Секрет генерирует клиент
   * (`keys.ts`); на шаге регистрации без JS — сервер (`registerSeed`).
   *
   * Переходы шагов: по итогу отправки (`form.state.result.data.step`).
   * Callback: `onDone` (JS) — закрыть модалку/перейти; без JS его заменяет
   * redirect экшена.
   */
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { StepLink, useSteps } from '#lib/components/steps/index.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import type { Result, Transport } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import CopyField from '#lib/components/form/CopyField.svelte'
  import { Button, FileInput, Input } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { generateKeyPair, sign } from '../keys.js'
  import { hydrateVault } from '../vault.svelte.js'
  import { prepareAvatar, type AvatarLimits } from '../avatar.js'
  import { authForm, AUTH_FORM_REV } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'

  type UserPayload = {
    access: string
    expiresAt: number
    ttlMs: number
    sub: string
    prof: { nickname: string | null; avatarUrl: string | null }
  }

  type StepData = {
    step?: 'entry' | 'register' | 'restore' | 'profile' | 'blocked' | 'restrictions' | 'done'
    user?: UserPayload
    blocked?: { reason: string; untilMs: number | null }
    restrictions?: readonly { scope: string; reason: string; untilMs: number | null }[]
    nonce?: string
  }

  interface Props {
    /** Данные страницы: challenge, next, пределы конфига, начальный шаг. */
    data: {
      challenge: { nonce: string; expiresAt: number } | null
      next: string | null
      limits: AvatarLimits & { holdSeconds: number }
      step: string
      registerSeed?: string | null
      enabled?: boolean
      user?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
    }
    /** Результат экшена (без JS): continuation привязки. */
    form?: { result?: Result } | null
    mode?: 'page' | 'modal'
    /** Callback успеха (JS): закрыть модалку / перейти. Без JS — redirect экшена. */
    onDone?: () => void
    /** Адрес экшена: на странице — сам адрес; в модалке — роут модалки
     * (`page.url.pathname` — страница ПОД модалкой, у неё своих экшенов нет). */
    actionUrl?: string
  }

  let { data, form: actionForm, mode = 'page', onDone, actionUrl }: Props = $props()

  // svelte-ignore state_referenced_locally -- адрес модалки постоянен за её жизнь
  const action = actionUrl ?? page.url.pathname
  const notHydrated = useJsOnly()

  /* ── привязка формы: тот же конфиг форм, что у всего проекта ── */
  // svelte-ignore state_referenced_locally -- challenge на момент отрисовки
  let nonce = $state(data.challenge?.nonce ?? '')

  /** Транспорт — общий для нативных экшенов; подпись живого nonce — ДО сети. */
  const transport: Transport = kitActionTransport(action, {
    prepare: async (fd) => {
      // вставка из буфера часто едет с пробелами по краям — подрезаем до формы
      const typed = String(fd.get('seed') ?? '').trim()
      fd.set('seed', typed)
      if (typed.length >= 43 && typed.length <= 44 && nonce !== '') {
        try {
          fd.set('signature', await sign(nonce, typed))
        } catch {
          /* в поле публичный seed — сервер ответит auth.signature */
        }
      }
    },
  })

  const bound = bind(forms, authForm, {
    action,
    transport,
    continuation: untrack(() => actionForm?.result ?? null),
  })

  /* ── шаг: универсальный хост (lib/components/steps), состояние виджета ── */
  // Решение владельца (ход 261, ревизия): step — состояние ВИДЖЕТА, адрес —
  // fallback. С JS клик по ссылке переключает шаг локально (на странице хост-
  // режим hybrid мягко синхронизирует адрес своим ключом брони — без навигации
  // и load; в модалке — local, адрес не трогается вовсе). Без JS ссылка честно
  // ведёт на адрес — данные страницы несёт load. Ответ экшена приоритетнее
  // данных страницы (навигации при нём нет).
  const initial = untrack(() => stepOf(actionForm?.result) ?? ({ step: data.step ?? 'entry' } as StepData))
  let blocked = $state<StepData['blocked']>(initial.blocked)
  let restrictions = $state<StepData['restrictions']>(initial.restrictions)
  // svelte-ignore state_referenced_locally -- режим выбирается один раз при
  // связывании: за жизнь виджета модалкой он не становится
  // Ключ адреса — `stage` (не `step`): бронь ключей глобальна на приложение,
  // `step` занят страницей /fields (lib/address/keys; конфликт = ошибка брони).
  const steps = useSteps({
    owner: 'auth',
    mode: mode === 'modal' ? 'local' : 'hybrid',
    key: 'stage',
    steps: () => [
      { key: 'entry', label: 'Авторизация', filled: true },
      { key: 'register', label: 'Создать аккаунт', filled: true },
    ],
    // начальное значение: данные загрузки / deep-link; дальше — set()
    current: () => (data.step as StepData['step']) ?? 'entry',
    // клик по ссылкам шага: seed делает браузер (не покидает устройство)
    onSwitch: (to) => switchStep(to as 'entry' | 'register'),
  })
  const step = $derived((steps.currentKey ?? 'entry') as StepData['step'])

  // сервер → хост: навигация/deep-link принесли новый ?step= (зависимость —
  // только data; локальные смены хоста адрес данных не меняют — цикла нет)
  $effect(() => {
    const server = data.step as StepData['step'] | undefined
    if (server) untrack(() => { if (steps.currentKey !== server) steps.set(server) })
  })
  $effect(() => {
    if (data.challenge?.nonce) nonce = data.challenge.nonce
  })

  function stepOf(result?: { data?: unknown }): StepData | undefined {
    const data = result?.data as StepData | undefined
    return data && typeof data === 'object' && 'step' in data ? data : undefined
  }

  // Итог отправки: шаг из данных результата; успех входа — гидратация vault.
  $effect(() => {
    const state = bound.state
    if (!state.result || !isSettledStatus(state.status)) return
    const next = stepOf(state.result)
    if (!next) return
    if (next.user) hydrateVault(next.user)
    if (next.step === 'done') {
      finish()
      return
    }
    untrack(() => {
      steps.set(next.step ?? 'entry')
      blocked = next.blocked
      restrictions = next.restrictions
      if (next.nonce) nonce = next.nonce
      if (next.step === 'entry' || next.step === 'register') void refreshChallenge()
    })
  })

  const isSettledStatus = (status: string): boolean => status === 'success' || status === 'error'

  /** Свежий nonce: любой неудачный вход тратит старый (одноразовость). */
  async function refreshChallenge(): Promise<void> {
    try {
      const fd = new FormData()
      const pairs: Record<string, string> = {}
      for (const pair of bound.hidden()) {
        fd.append(pair.name, pair.value)
        pairs[pair.name] = pair.value
      }
      fd.append('intent', 'challenge')
      // envelope — структура для синтетического Result при сбое сети
      const envelope = {
        formId: 'user-auth',
        revision: AUTH_FORM_REV,
        instance: `user-auth:${crypto.randomUUID()}`,
        submissionId: crypto.randomUUID(),
        intent: 'challenge',
      } as const
      const out = await transport({ envelope, data: fd, accept: ['application/json'], signal: new AbortController().signal })
      const fresh = (out.kind === 'result' ? (out.result.data as { nonce?: string } | undefined)?.nonce : undefined)
      if (fresh) nonce = fresh
    } catch {
      /* останется старый — сервер ответит auth.nonce-unknown */
    }
  }

  function finish(): void {
    if (onDone) {
      onDone()
      return
    }
    // страница без next: молчание выглядит как «кнопка не работает» — уходим домой
    void goto(data.next ?? '/')
  }

  /* ── seed: с JS генерирует БРАУЗЕР (ключ не покидает устройство); сервер —
     fallback без JS / обновления / deep-link. Копирование — подмена поля ── */
  // Значение живёт в состоянии ФОРМЫ (его валидирует и отправляет движок):
  // старт — синхронный onInput при связывании, переходы — зеркало (оба приёма
  // и их грабли — в field-mirror.svelte.ts). Локальная смена шага — клик по
  // ссылке с JS: генерируем здесь же и переключаем шаг хостом; серверный seed
  // при этом в HTML не попадает (load не запрашивался — смены нет на сервере).
  let localSeed = $state<string | null>(null)
  const secret = $derived(localSeed ?? data.registerSeed ?? '')
  mirrorToField(bound, 'seed', () => secret)

  /** Локальная смена шага с JS: на регистрации ключ делает браузер. */
  async function switchStep(to: 'entry' | 'register'): Promise<void> {
    if (steps.currentKey === to) return
    localSeed = to === 'register' ? (await generateKeyPair()).secret : null
    steps.set(to)
  }

  /* ── аватар: конвейер с пределами из конфига; результат — скрытое поле ── */
  let avatarUrl = $state<string | null>(null)
  let avatarBusy = $state(false)
  let avatarError = $state<string | null>(null)

  async function onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const picked = input.files?.[0]
    if (!picked) return
    avatarBusy = true
    avatarError = null
    try {
      const outcome = await prepareAvatar(picked, data.limits)
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

  const when = (ms: number | null | undefined): string =>
    ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'бессрочно'

  // Только коды КЛИЕНТСКОГО конвейера аватара (они не форма-ошибки); тексты
  // доменных кодов живёт в `messages` формы — сервер наполняет message сам.
  const AVATAR_TEXTS: Record<string, string> = {
    'profile.avatar-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'profile.avatar-size': 'Картинка не сжимается до нужного веса — возьмите другую',
  }

  // svelte-ignore state_referenced_locally -- пределы конфига неизменны за жизнь виджета
  const holdSeconds = data.limits.holdSeconds
</script>

<Form id="user-auth" form={bound} hiddenFields={bound.hidden()} class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left">
  <Common errors={bound.common} title="Проверьте форму" />

  {#if data.enabled === false}
    <!-- конвенция репо: без env функция выключена с объяснением (как курсор lib/db) -->
    <div class="rounded-md border border-border bg-muted/40 p-3 text-sm">
      Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать.
      Задайте переменную и перезапустите приложение.
    </div>
  {:else}
  {#if avatarError}
    <p role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{avatarError}</p>
  {/if}

  <!-- скрытый nonce живёт здесь: форму покидает вместе с конвертом -->
  <Input type="hidden" name="nonce" value={nonce} />

  {#if step === 'entry' || step === 'register'}
    <!-- ссылка шага справа: вход ↔ создание (ТЗ). Адрес в href — fallback без JS
         (честная страница, данные несёт load); с JS клик локален — смену делает
         хост (в модалке адрес не трогается, на странице синхронизируется мягко) -->
    <div class="flex items-baseline justify-end gap-2">
      {#each steps.items as it (it.key)}
        {#if !it.current}
          <StepLink host={steps} step={it.key} class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            {it.label}
          </StepLink>
        {/if}
      {/each}
    </div>

    {#if step === 'register'}
      {#if localSeed}
        <!-- JS-переход: ключ сделал браузер, в HTML страницы он не попадал -->
        <div class="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p class="font-medium">Seed сгенерирован в этом браузере</p>
          <p class="text-xs text-muted-foreground">
            Ключ создан локально и не покидал ваше устройство. Сохраните его в менеджере
            секретов: он показывается один раз.
          </p>
        </div>
      {:else}
        <!-- fallback (без JS, обновление, deep-link): генерирует и подписывает СЕРВЕР;
             seed виден в HTML страницы -->
        <div class="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p class="font-medium">Seed создал и подписал сервер</p>
          <p class="text-xs text-muted-foreground">
            Он уже виден в HTML этой страницы — не открывайте форму в общих и публичных местах:
            увидевший seed получит доступ к аккаунту. Сохраните его в менеджере секретов:
            он показывается один раз.
          </p>
        </div>
      {/if}
    {/if}

    <!-- Подмена примитива (решение владельца): на регистрации — CopyField (Input →
         CopyInput → CopyField), на входе — обычный Input из resolve. Подпись,
         подсказка и ошибки — FieldShell. -->
    <Field of={bound.f.seed} instead={step === 'register' ? CopyField : undefined} />

    {#if step === 'entry'}
      <Button type="submit" name="intent" value="login" task={formTask(bound.state)}>Авторизация</Button>
      {#if data.user}
        <!-- без JS меню-модалки нет: выход здесь (куки снимает экшен) -->
        <Button type="submit" name="intent" value="logout" variant="ghost" size="sm" task={formTask(bound.state)}>
          Выйти из аккаунта
        </Button>
      {/if}
    {:else}
      {#if notHydrated()}
        <!-- без JS удержание недоступно: обычная кнопка отправки -->
        <Button type="submit" name="intent" value="login" variant="outline" task={formTask(bound.state)}>Создать аккаунт</Button>
      {:else}
        <!-- hover: заливка от курсора (решение владельца, ход 258); нажатие тоже работает -->
        <HoldButton
          type="submit"
          name="intent"
          value="login"
          variant="outline"
          seconds={holdSeconds}
          when="fill"
          hover
          task={formTask(bound.state)}
        >
          Удерживайте, чтобы создать аккаунт
        </HoldButton>
      {/if}
    {/if}
  {:else if step === 'restore'}
    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Аккаунт ждёт удаления</h2>
      <p class="text-sm text-muted-foreground">
        Вы раньше попросили удалить аккаунт. Можно вернуть всё как было — заявка будет отменена,
        и вы останетесь в аккаунте. Если ничего не делать, аккаунт удалится сам по истечении срока.
      </p>
      <Button type="submit" name="intent" value="restore" task={formTask(bound.state)}>Восстановить аккаунт</Button>
      <Button type="submit" name="intent" value="logout" variant="ghost" size="sm" task={formTask(bound.state)}>
        Выйти без восстановления
      </Button>
    </div>
  {:else if step === 'profile'}
    {@const nickF = bound.field('nickname')!}
    {@const avatarF = bound.field('avatar')}
    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Как вас показывать?</h2>
      <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
      <div class="space-y-1.5" data-field={nickF.name}>
        <label {...nickF.labelProps()} class="flex flex-col gap-1 text-sm">
          Никнейм
          <Input
            {...nickF.attrs}
            value={String(nickF.value ?? '')}
            placeholder="необязательно"
            autocomplete="nickname"
            onblur={() => nickF.setTouched()}
            oninput={(e) => nickF.onInput(e.currentTarget.value)}
          />
        </label>
        {#if nickF.errors[0]}
          <p {...nickF.errorProps()} class="text-xs font-medium text-destructive">{nickF.errors[0].message}</p>
        {/if}
      </div>
      <div class="space-y-1.5" data-field={avatarF?.name ?? 'avatar'}>
        <label class="flex flex-col gap-1 text-sm">
          Аватар
          <!-- файл только с JS (ТЗ); без JS поле выключено, сервер файла не ждёт.
               Круглый предпросмотр ниже — свой (ТЗ), поэтому preview не включаем. -->
          <FileInput
            accept="image/jpeg,image/png,image/webp"
            onchange={onFileChange}
            disabled={notHydrated() || avatarBusy}
            title={notHydrated() ? JS_ONLY_REASON : undefined}
          />
        </label>
        {#if avatarUrl}
          <Input type="hidden" name="avatar" value={avatarUrl} />
          <img src={avatarUrl} alt="Предпросмотр аватара" class="h-16 w-16 rounded-full object-cover" />
        {/if}
        {#if avatarF?.errors[0]}
          <!-- ошибки сервера по аватару (скрытое поле): раньше гасились молча —
               владелец видел «ничего не происходит» (ход 261) -->
          <p {...avatarF.errorProps()} class="text-xs font-medium text-destructive">{avatarF.errors[0].message}</p>
        {/if}
      </div>
      <div class="flex items-center justify-between gap-2">
        <!-- «Сохранить» слева, «Отмена» справа (ТЗ); intent едет от нажатой кнопки -->
        <Button type="submit" name="intent" value="profile" task={formTask(bound.state)}>Сохранить</Button>
        <Button type="submit" name="intent" value="skip-profile" variant="ghost" task={formTask(bound.state)}>Отмена</Button>
      </div>
    </div>
  {:else if step === 'blocked'}
    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Аккаунт заблокирован</h2>
      <p class="text-sm text-muted-foreground">
        Причина: {blocked?.reason ?? 'не указана'}. До: {when(blocked?.untilMs)}.
      </p>
      <p class="text-xs text-muted-foreground">Вход в аккаунт закрыт, пока блокировка действует.</p>
    </div>
  {:else if step === 'restrictions'}
    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Ограничения аккаунта</h2>
      <ul class="flex flex-col gap-2 text-sm text-muted-foreground">
        {#each restrictions ?? [] as r (r.scope + r.reason)}
          <li>
            <span class="font-medium text-foreground">{r.scope}</span>: {r.reason}
            — до {when(r.untilMs)}
          </li>
        {/each}
      </ul>
      <div class="flex justify-end">
        <!-- «Принято» справа (ТЗ); вход уже случился, подтверждение ничего не меняет -->
        <Button type="submit" name="intent" value="accept" variant="outline" task={formTask(bound.state)}>Принято</Button>
      </div>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">Готово.</p>
  {/if}
  {/if}
</Form>
