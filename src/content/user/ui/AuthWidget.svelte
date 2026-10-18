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
  import type { Result, Transport } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button, Input } from '#lib/components/ui/index.js'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { generateKeyPair, sign } from '../keys.js'
  import { hydrateVault } from '../vault.svelte.js'
  import { unwrapKitAction } from '../vault.js'
  import { prepareAvatar, type AvatarLimits } from '../avatar.js'
  import { authForm } from '../forms.js'

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

  /** Транспорт: подписать живой nonce секретом из поля, потом fetch на экшен. */
  const transport: Transport = async (req) => {
    try {
      const typed = String(req.data.get('seed') ?? '')
      if (typed.length >= 43 && typed.length <= 44 && nonce !== '') {
        try {
          req.data.set('signature', await sign(nonce, typed))
        } catch {
          /* в поле публичный seed — сервер ответит auth.signature */
        }
      }
      const res = await fetch(action, {
        method: 'POST',
        body: req.data,
        headers: { accept: 'application/json' },
        signal: req.signal,
      })
      const ct = res.headers.get('content-type') ?? ''
      const body = ct.includes('application/json') ? await res.json().catch(() => null) : null
      // Kit упаковывает ответ экшена в devalue-форму; распаковка — общая
      const result = unwrapKitAction(body)?.result as Result | undefined
      if (result && typeof result === 'object' && result.v === 1) {
        return { kind: 'result', result }
      }
      return { kind: 'network', code: 'network.failed', detail: `HTTP ${res.status}` }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { kind: 'abort', reason: 'aborted' }
      return { kind: 'network', code: 'network.failed', detail: String(e) }
    }
  }

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

  function stepOf(result?: Result): StepData | undefined {
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
      for (const pair of bound.hidden()) fd.append(pair.name, pair.value)
      fd.append('intent', 'challenge')
      const res = await fetch(action, { method: 'POST', body: fd, headers: { accept: 'application/json' } })
      const body = (await res.json()) as unknown
      const fresh = (unwrapKitAction(body)?.result?.data as { nonce?: string } | undefined)?.nonce
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
    if (data.next) void goto(data.next)
  }

  /* ── seed: генерация клиентом, копирование ── */
  // svelte-ignore state_referenced_locally -- серверный seed приходит один раз с шагом
  let secret = $state(data.registerSeed ?? '')
  let copied = $state(false)

  async function startRegister(): Promise<void> {
    const pair = await generateKeyPair()
    secret = pair.secret
    step = 'register'
  }

  async function copySecret(): Promise<void> {
    await navigator.clipboard.writeText(secret)
    copied = true
    setTimeout(() => (copied = false), 2000)
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
      else avatarError = TEXTS[outcome.code]
      if (!outcome.ok) input.value = ''
    } catch {
      avatarError = TEXTS['profile.avatar-format']
      input.value = ''
    } finally {
      avatarBusy = false
    }
  }

  const when = (ms: number | null | undefined): string =>
    ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'бессрочно'

  const TEXTS: Record<string, string> = {
    'auth.nonce-unknown': 'Время на вход истекло — попробуйте ещё раз',
    'auth.signature': 'Seed или подпись не сошлись — проверьте ввод',
    'auth.identity-unknown': 'Аккаунта с таким seed больше нет',
    'auth.token': 'Сессия повреждена — войдите заново',
    'auth.expired': 'Время сессии вышло — войдите заново',
    'auth.revoked': 'Сеанс завершён на этом устройстве',
    'auth.session-unknown': 'Сессия не найдена — войдите заново',
    'auth.blocked': 'Аккаунт заблокирован',
    'auth.delete-pending': 'Заявка на удаление ещё активна',
    'auth.confirm': 'Что-то пошло не так — попробуйте ещё раз',
    'profile.nickname-forbidden': 'Такой никнейм нельзя: 2–32 знака, без служебных имён (admin, root, …)',
    'profile.avatar-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'profile.avatar-size': 'Картинка не сжимается до нужного веса — возьмите другую',
  }

  // svelte-ignore state_referenced_locally -- пределы конфига неизменны за жизнь виджета
  const holdSeconds = data.limits.holdSeconds
</script>

<Form id="user-auth" form={bound} hiddenFields={bound.hidden()} class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left">
  {#if avatarError}
    <p role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{avatarError}</p>
  {/if}

  <!-- скрытый nonce живёт здесь: форму покидает вместе с конвертом -->
  <Input type="hidden" name="nonce" value={nonce} />

  {#if step === 'entry' || step === 'register'}
    <div class="flex items-baseline justify-between gap-2">
      <!-- label + ссылка справа: вход ↔ создание (ТЗ) -->
      <label for="auth-seed" class="text-sm font-medium">Seed</label>
      {#if step === 'entry'}
        <button
          type="button"
          class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onclick={startRegister}
        >Создать аккаунт</button>
      {:else}
        <button
          type="button"
          class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onclick={() => (step = 'entry')}
        >Авторизация</button>
      {/if}
    </div>

    {#if step === 'register'}
      <p class="text-xs text-muted-foreground">
        {data.registerSeed
          ? 'Seed создан сервером — сохраните его: он показывается один раз.'
          : 'Сохраните seed в менеджер секретов: это единственный ключ от аккаунта, он показывается один раз.'}
      </p>
    {/if}

    <div class="relative">
      <Input
        id="auth-seed"
        name="seed"
        bind:value={secret}
        readonly={step === 'register'}
        autocomplete="off"
        spellcheck="false"
        minlength={43}
        maxlength={44}
        class="pr-16 font-mono text-xs"
      />
      {#if step === 'register'}
        <!-- копирование прямо в поле ввода (ТЗ); без JS кнопки нет — текст выделяется -->
        <button
          type="button"
          onclick={copySecret}
          class="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >{copied ? 'Готово' : 'Копия'}</button>
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
      <Button type="submit" name="intent" value="login" variant="destructive" task={formTask(bound.state)}>Создать аккаунт</Button>
    {:else}
      <HoldButton type="submit" name="intent" value="login" seconds={holdSeconds} when="fill" task={formTask(bound.state)}>
        Создать аккаунт
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
    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Как вас показывать?</h2>
      <p class="text-xs text-muted-foreground">Можно пропустить — всё это можно заполнить и потом.</p>
      <label class="flex flex-col gap-1 text-sm">
        Никнейм
        <Input name="nickname" maxlength={32} placeholder="необязательно" autocomplete="nickname" />
      </label>
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
</Form>
