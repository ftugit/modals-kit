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
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import type { Result, Transport } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button, CopyInput, Input } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { generateKeyPair, sign } from '../keys.js'
  import { hydrateVault } from '../vault.svelte.js'
  import { prepareAvatar, type AvatarLimits } from '../avatar.js'
  import { authForm, AUTH_FORM_REV } from '../forms.js'

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

  /* ── шаг: серверный начальный → результат экшена → переходы по итогу ── */
  // Намеренный снимок на момент связывания (как `initialResult` у демо-форм):
  const initial = untrack(() => stepOf(actionForm?.result) ?? ({ step: data.step ?? 'entry' } as StepData))
  let step = $state<StepData['step']>(initial.step)
  let blocked = $state<StepData['blocked']>(initial.blocked)
  let restrictions = $state<StepData['restrictions']>(initial.restrictions)

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
      step = next.step
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

  /* ── seed: генерация клиентом; копирование — примитив CopyInput ── */
  // svelte-ignore state_referenced_locally -- серверный seed приходит один раз с шагом
  let secret = $state(data.registerSeed ?? '')

  async function startRegister(): Promise<void> {
    const pair = await generateKeyPair()
    secret = pair.secret
    step = 'register'
  }

  /** На вход: поле чистое — seed шага регистрации сюда перетаскивать не надо. */
  function switchToEntry(): void {
    secret = ''
    step = 'entry'
  }

  // Значение seed живёт в состоянии ФОРМЫ (его валидирует и отправляет движок);
  // локальный secret — источник шага регистрации, эффект держит зеркало.
  // До гидрации (SSR/без JS) состояние пусто — значение в DOM несёт сам secret.
  const seedSetter = bound.field('seed')
  $effect(() => {
    seedSetter?.onInput(secret)
  })

  /**
   * Адрес шага для перехода БЕЗ JS (маркер шага — в адресе, его читает load):
   * на странице — текущий адрес с шагом (next сохраняется); из модалки —
   * честная страница входа (без JS модалка не удерживается).
   * С JS клик перехвачен — seed генерирует клиент.
   */
  function stepHref(to: 'register' | 'entry'): string {
    const u = new URL(page.url.href) // копия: page.url у SvelteKit readonly
    if (mode === 'modal') {
      u.pathname = action
      u.search = ''
    }
    if (to === 'register') u.searchParams.set('step', 'register')
    else u.searchParams.delete('step')
    return `${u.pathname}${u.search}`
  }

  /** Ссылка работает и без JS (переход по адресу), и с JS (локальная подмена). */
  const linkStep = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault()
    fn()
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
    <div class="flex items-baseline justify-between gap-2">
      <!-- label + ссылка справа: вход ↔ создание (ТЗ) -->
      <label {...bound.field('seed')?.labelProps()} class="text-sm font-medium">Seed</label>
      {#if step === 'entry'}
        <a
          href={stepHref('register')}
          class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onclick={linkStep(startRegister)}
        >Создать аккаунт</a>
      {:else}
        <a
          href={stepHref('entry')}
          class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onclick={linkStep(switchToEntry)}
        >Авторизация</a>
      {/if}
    </div>

    {#if step === 'register'}
      <p class="text-xs text-muted-foreground">
        {data.registerSeed
          ? 'Seed создан сервером — сохраните его: он показывается один раз.'
          : 'Сохраните seed в менеджер секретов: это единственный ключ от аккаунта, он показывается один раз.'}
      </p>
    {/if}

    {@const seedF = bound.field('seed')!}
    <!-- data-field — ручка тестов и стилей (как у FieldShell) -->
    <div class="space-y-1.5" data-field={seedF.name}>
      <!-- поле с копированием своего содержимого (примитив CopyInput); без JS
           кнопки нет — текст выделяется -->
      <CopyInput
        {...seedF.attrs}
        value={String(seedF.value ?? '') || secret}
        readonly={step === 'register'}
        autocomplete="off"
        spellcheck="false"
        copyLabel="Копировать seed"
        copiedLabel="Скопировано"
        onblur={() => seedF.setTouched()}
        oninput={(e) => seedF.onInput(e.currentTarget.value)}
        class="font-mono text-xs"
      />
      <!-- help и ошибки поля — проводка движка (разметка ТЗ не влезает в FieldShell) -->
      {#if seedF.help}
        <p {...seedF.helpProps()} class="text-xs text-muted-foreground">{seedF.help}</p>
      {/if}
      {#if seedF.errors[0]}
        <p {...seedF.errorProps()} class="text-xs font-medium text-destructive">{seedF.errors[0].message}</p>
      {/if}
    </div>

    {#if step === 'entry'}
      <Button type="submit" name="intent" value="login" task={formTask(bound.state)}>Авторизация</Button>
      {#if data.user}
        <!-- без JS меню-модалки нет: выход здесь (куки снимает экшен) -->
        <Button type="submit" name="intent" value="logout" variant="ghost" size="sm" task={formTask(bound.state)}>
          Выйти из аккаунта
        </Button>
      {/if}
    {:else if data.registerSeed}
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
      <label class="flex flex-col gap-1 text-sm">
        Аватар
        <!-- файл только с JS (ТЗ); без JS поле выключено, сервер файла не ждёт -->
        <Input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onchange={onFileChange}
          disabled={notHydrated() || avatarBusy}
          title={notHydrated() ? JS_ONLY_REASON : undefined}
          class="text-sm file:mr-2 file:rounded file:border-0 file:bg-accent file:px-2 file:py-1 file:text-xs"
        />
      </label>
      {#if avatarUrl}
        <Input type="hidden" name="avatar" value={avatarUrl} />
        <img src={avatarUrl} alt="Предпросмотр аватара" class="h-16 w-16 rounded-full object-cover" />
      {/if}
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
