<script lang="ts">
  /**
   * Виджет авторизации — хост шагов и куст формы входа на его шаге `auth`:
   * полный ключ — цепочка (`?stage=auth.restore`): шаги хоста —
   * `auth`/`blocked`/`restrictions`/`profile`, внутри `auth` форму
   * (`authForm`) режет `formSteps` на срезы entry/register/restore
   * (различает интент: вход и создание — один `login`). Профиль — отдельный
   * компонент со своей формой (`ProfileForm`); блокировка и ограничения —
   * UI-шаги без формы («Принято» — программная отправка конверта).
   * Отправка — штатный путь `lib/form`: `bind` + `Form` (raw form-теги в
   * роутах запрещены), транспорт — fetch на экшен с accept: application/json;
   * без JS нативный POST — тот же экшен, шаг приезжает в `form.result.data`.
   *
   * Подпись nonce — в транспорте (место сетевого вызова): перед отправкой
   * секретом из поля подписывается живой nonce. Секрет генерирует клиент
   * (`keys.ts`); на шаге регистрации без JS — сервер (`registerSeed`).
   *
   * Переходы: срезы ведёт сам formSteps по результату формы; шаги вне куста
   * и побочные данные (vault, nonce, блокировка) — эффект виджета ниже.
   * Callback: `onDone` (JS) — закрыть модалку/перейти; без JS его заменяет
   * redirect экшена.
   */
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { goto } from '$app/navigation'
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { StepLink, formSteps, suffixOf, useSteps } from '#lib/components/steps/index.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import type { Result, Transport } from '#lib/form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import CopyField from '#lib/components/form/CopyField.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import { generateKeyPair, sign } from '../keys.js'
  import { hydrateVault } from '../vault.svelte.js'
  import { type AvatarLimits } from '../avatar.js'
  import { authEnvelope, authEnvelopeFields, authForm, AUTH_FORM_REV } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import ProfileForm from './ProfileForm.svelte'

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
     * (путь видимого адреса — страница ПОД модалкой, у неё своих экшенов нет). */
    actionUrl?: string
  }

  let { data, form: actionForm, mode = 'page', onDone, actionUrl }: Props = $props()

  // svelte-ignore state_referenced_locally -- адрес модалки постоянен за её жизнь
  const action = actionUrl ?? visibleAddress().url.pathname
  const notHydrated = useJsOnly()
  const doneHref = $derived(data.next ?? '/')

  /* ── привязка формы входа: тот же конфиг форм, что у всего проекта ── */
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

  // nonce — поле ОПИСАНИЯ (hidden): значение живёт в состоянии формы и
  // рисуется HiddenField ниже; локальный nonce — источник для подписи в
  // транспорте, в поле его зеркалит mirrorToField (как seed).
  mirrorToField(bound, 'nonce', () => nonce)

  /* ── шаги: хост (lib/components/steps) + куст срезов формы на шаге auth ── */
  // Решение владельца (ход 261, ревизия): step — состояние ВИДЖЕТА, адрес —
  // fallback. С JS клик по ссылке переключает шаг локально (на странице хост-
  // режим hybrid мягко синхронизирует адрес своим ключом брони — без навигации
  // и load; в модалке — local, адрес не трогается вовсе). Без JS ссылка честно
  // ведёт на адрес — данные страницы несёт load. Ответ экшена приоритетнее
  // данных страницы (навигации при нём нет).
  const initial = untrack(() => stepOf(actionForm?.result) ?? ({} as StepData))
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
      { key: 'auth', label: 'Авторизация', filled: true },
      { key: 'blocked', label: 'Блокировка' },
      { key: 'restrictions', label: 'Ограничения' },
      { key: 'profile', label: 'Профиль' },
    ],
    // начальное значение: данные загрузки / deep-link; дальше — set()
    current: () => data.step ?? 'auth.entry',
    // клик по ссылкам шага: seed делает браузер (не покидает устройство)
    onSwitch: (to) => switchStep(to),
  })
  // Куст срезов формы на шаге `auth`: текущий срез ведёт сам formSteps —
  // по результату формы (Result.intent/data.step) и по полному ключу хоста
  // (deep-link `?stage=auth.register`, клики по ссылкам срезов). Панели
  // FormSteps здесь НЕ используются: срезы делят одни поля (seed/nonce), а
  // кнопки у срезов разные — разметку по `fs.current` рисует сам виджет.
  const fs = formSteps(bound, {
    steps: [
      { key: 'entry', label: 'Авторизация' },
      { key: 'register', label: 'Создать аккаунт' },
      { key: 'restore', label: 'Восстановление' },
    ],
    at: 'auth',
    host: steps,
    // вход и создание — один экшен login (сервер различает по seed): общий
    // экшен отправленный срез по интенту не называет (stepOfResult)
    actionOf: (s) => (s === 'restore' ? 'restore' : 'login'),
  })
  const hostStep = $derived(steps.currentKey ?? 'auth')

  // сервер → хост: навигация/deep-link принесли новый полный ключ ?stage=
  // (зависимость — только data; локальные смены хоста адрес данных не
  // меняют — цикла нет)
  $effect(() => {
    const server = data.step
    if (server) untrack(() => { if (steps.fullKey !== server) steps.set(server) })
  })
  $effect(() => {
    if (data.challenge?.nonce) nonce = data.challenge.nonce
  })

  function stepOf(result?: { data?: unknown }): StepData | undefined {
    const data = result?.data as StepData | undefined
    return data && typeof data === 'object' && 'step' in data ? data : undefined
  }

  // Итог отправки формы входа. Срезы куста ведёт сам formSteps; здесь —
  // шаги хоста ВНЕ куста, успех входа (гидратация vault) и побочные данные.
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
      if (next.step === 'blocked' || next.step === 'restrictions' || next.step === 'profile')
        steps.set(next.step)
      blocked = next.blocked
      restrictions = next.restrictions
      if (next.nonce) nonce = next.nonce
      // restore: вход потратил nonce, а подтверждение подписывает свежий
      if (next.step === 'entry' || next.step === 'register' || next.step === 'restore') void refreshChallenge()
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

  /**
   * «Принято» на шаге ограничений — программная отправка конверта auth
   * (механизм authEnvelope*, как продление vault): формы на этом шаге нет.
   * Вход уже случился — подтверждение ничего не меняет, поэтому финиш
   * наступает при любом исходе отправки.
   */
  let acceptBusy = $state(false)
  async function acceptRestrictions(): Promise<void> {
    if (acceptBusy) return
    acceptBusy = true
    try {
      const envelope = authEnvelope(`user-auth:${crypto.randomUUID()}`)
      const fd = new FormData()
      for (const [k, v] of Object.entries(authEnvelopeFields(envelope))) fd.append(k, v)
      fd.append('intent', 'accept')
      await transport({ envelope, data: fd, accept: ['application/json'], signal: new AbortController().signal })
    } catch {
      /* сеть упала — вход уже случился, финиш всё равно */
    }
    finish()
  }

  function finish(): void {
    if (onDone) {
      onDone()
      return
    }
    // страница без next: молчание выглядит как «кнопка не работает» — уходим домой
    void goto(doneHref)
  }

  /* ── seed: с JS генерирует БРАУЗЕР (ключ не покидает устройство); сервер —
     fallback без JS / обновления / deep-link. Копирование — подмена поля ── */
  // Значение живёт в состоянии ФОРМЫ (его валидирует и отправляет движок):
  // старт — синхронный onInput при связывании, переходы — зеркало (оба приёма
  // и их грабли — в field-mirror.svelte.ts). Локальная смена среза — клик по
  // ссылке с JS: генерируем здесь же и переключаем полный ключ хостом
  // (formSteps подхватит срез из остатка); серверный seed при этом в HTML не
  // попадает (load не запрашивался — смены нет на сервере).
  let localSeed = $state<string | null>(null)
  const secret = $derived(localSeed ?? data.registerSeed ?? '')
  mirrorToField(bound, 'seed', () => secret)

  /** Клик по ссылке хоста (полный ключ): на срезе регистрации ключ делает браузер. */
  async function switchStep(to: string): Promise<void> {
    if (steps.fullKey === to) return
    const inner = suffixOf(to, 'auth')
    if (inner === 'register') localSeed = (await generateKeyPair()).secret
    else if (inner === 'entry') localSeed = null
    steps.set(to)
  }

  const when = (ms: number | null | undefined): string =>
    ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'бессрочно'

  // svelte-ignore state_referenced_locally -- пределы конфига неизменны за жизнь виджета
  const holdSeconds = data.limits.holdSeconds
</script>

{#if data.enabled === false}
  <!-- конвенция репо: без env функция выключена с объяснением (как курсор lib/db) -->
  <div class="mx-auto w-full max-w-sm rounded-md border border-border bg-muted/40 p-3 text-left text-sm">
    Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать.
    Задайте переменную и перезапустите приложение.
  </div>
{:else if hostStep === 'blocked'}
  <div class="mx-auto flex w-full max-w-sm flex-col gap-3 text-left">
    <h2 class="text-base font-semibold">Аккаунт заблокирован</h2>
    <p class="text-sm text-muted-foreground">
      Причина: {blocked?.reason ?? 'не указана'}. До: {when(blocked?.untilMs)}.
    </p>
    <p class="text-xs text-muted-foreground">Вход в аккаунт закрыт, пока блокировка действует.</p>
  </div>
{:else if hostStep === 'restrictions'}
  <div class="mx-auto flex w-full max-w-sm flex-col gap-3 text-left">
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
      <!-- «Принято» справа (ТЗ); вход уже случился, подтверждение ничего не
           меняет: с JS — программный конверт accept, без JS — ссылка дальше -->
      {#if notHydrated()}
        <Button href={doneHref} variant="outline">Принято</Button>
      {:else}
        <Button type="button" variant="outline" disabled={acceptBusy} onclick={() => void acceptRestrictions()}>Принято</Button>
      {/if}
    </div>
  </div>
{:else if hostStep === 'profile'}
  <ProfileForm action={action} form={actionForm} limits={data.limits} initial={data.user?.prof ?? null} doneHref={doneHref} onDone={finish} />
{:else}
  <Form id="user-auth" form={bound} hiddenFields={bound.hidden()} class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left">
    <Common errors={bound.common} title="Проверьте форму" />

    <!-- скрытые поля описания рисует сама lib/form (HiddenField): nonce —
         значение из состояния (зеркало выше); подпись значения в состоянии
         не имеет — её при отправке ставит prepare транспорта -->
    <Field of={bound.f.nonce} />
    <Field of={bound.f.signature} />

    {#if fs.current === 'entry' || fs.current === 'register'}
      <!-- ссылка среза справа: вход ↔ создание (ТЗ). Адрес в href — fallback без
           JS (честная страница ?stage=auth.register, данные несёт load); с JS
           клик локален — полный ключ меняет хост, срез подхватывает formSteps -->
      <div class="flex items-baseline justify-end gap-2">
        {#each fs.steps as s (s.key)}
          {#if (s.key === 'entry' || s.key === 'register') && fs.current !== s.key}
            <StepLink host={steps} step={`auth.${s.key}`} class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
              {s.label}
            </StepLink>
          {/if}
        {/each}
      </div>

      {#if fs.current === 'register'}
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
      <Field of={bound.f.seed} instead={fs.current === 'register' ? CopyField : undefined} />

      {#if fs.current === 'entry'}
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
    {:else if fs.current === 'restore'}
      <div class="flex flex-col gap-3">
        <h2 class="text-base font-semibold">Аккаунт ждёт удаления</h2>
        <p class="text-sm text-muted-foreground">
          Вы раньше попросили удалить аккаунт, поэтому вход в него закрыт. Можно вернуть всё как было:
          заявка будет отменена, и вход продолжится. Если ничего не делать, аккаунт удалится сам
          по истечении срока.
        </p>
        <!-- seed — поле среза: значение со среза входа едет в отправку подтверждения
             (доказательство владения проверяет сервер); показывать его незачем -->
        <div hidden aria-hidden="true"><Field of={bound.f.seed} /></div>
        <Button type="submit" name="intent" value="restore" task={formTask(bound.state)}>Восстановить аккаунт</Button>
        <Button type="submit" name="intent" value="logout" variant="ghost" size="sm" task={formTask(bound.state)}>
          Не восстанавливать
        </Button>
      </div>
    {/if}
  </Form>
{/if}
