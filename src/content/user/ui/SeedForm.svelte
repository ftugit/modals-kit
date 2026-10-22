<script lang="ts">
  /**
   * Универсальная форма доказательства владения `seed` (`seedForm`), нарезанная
   * на шаги через `formSteps`.
   *
   * Параметр `authorize` определяет режим работы компонента:
   *   - `authorize = true` (по умолчанию для `'entry' | 'register' | 'restore'`):
   *     гостевые срезы входа, создания аккаунта и восстановления после удаления
   *     под защитой `<Acl allow="guest">`. На сервере открывается сессия.
   *   - `authorize = false` (срез `'confirm'` для критичных операций):
   *     подтверждение владения `seed` уже авторизованным пользователем под
   *     защитой `<Acl allow="user">` (удаление аккаунта, смена второго фактора
   *     и т.п.). Сервер по интенту `'confirm'` проверяет активную сессию
   *     (`guard`), одноразовый `nonce` и совпадение `seed` с текущим `sub` —
   *     БЕЗ перевыпуска сессии и кук.
   */
  import { untrack } from 'svelte'
  import { Form, formTask, type BoundForm } from '#lib/form/svelte/index.js'
  import { formSteps, StepLink, useSteps, type StepsHost } from '#lib/components/steps/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import CopyField from '#lib/components/form/CopyField.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import { sign } from '../keys.js'
  import { seedForm } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import Acl from './Acl.svelte'

  export type SeedView = 'entry' | 'register' | 'restore' | 'confirm'

  interface Props {
    /** Активный срез формы (`entry` | `register` | `restore` | `confirm`). */
    view?: SeedView
    /**
     * Открывать ли пользовательскую сессию при успешном доказательстве `seed`:
     * - `true` — вход / создание / восстановление гостя (`Acl allow="guest"`);
     * - `false` — повторное подтверждение владения для авторизованного
     *   пользователя (`Acl allow="user"`, интент `'confirm'`, сессия не меняется).
     */
    authorize?: boolean
    /** Внешний хост шагов (например, `AuthWidget`); без него создаётся локальный `useSteps`. */
    host?: StepsHost
    /** Внешняя привязка `seedForm` от координатора; без неё создаётся автономная. */
    bound?: BoundForm
    /** Challenge `nonce` при автономном использовании. */
    nonce?: string
    /** Начальный `seed` при автономном использовании. */
    seed?: string
    /** Сгенерирован ли `seed` локально в этом браузере (для памятки на `register`). */
    localSeed?: string | null
    /** Длительность удержания кнопки создания аккаунта, с. */
    holdSeconds?: number
    /** Заголовок и пояснение для режима `authorize={false}` (`confirm`). */
    confirmTitle?: string
    confirmDescription?: string
    confirmLabel?: string
    /** Включён ли модуль на сервере (`AUTH_SEAL_SECRET`). */
    enabled?: boolean
    /** Явный статус авторизации субъекта (иначе читается из `vault` / `page.data.user`). */
    authorized?: boolean
    /** Адрес возврата на экране отказа `Acl`. */
    doneHref?: string
    /** Коллбэк успешного подтверждения владения при `authorize={false}`. */
    onConfirmed?: (payload: { sub?: string }) => void
  }

  let {
    view = 'entry',
    authorize,
    host,
    bound: externalBound,
    nonce = '',
    seed = '',
    localSeed = null,
    holdSeconds = 2,
    confirmTitle = 'Подтвердите владение аккаунтом',
    confirmDescription = 'Введите ваш seed, чтобы подтвердить операцию. Текущая сессия не изменится.',
    confirmLabel = 'Подтвердить',
    enabled,
    authorized,
    doneHref = '/',
    onConfirmed,
  }: Props = $props()

  const notHydrated = useJsOnly()

  const shouldAuthorize = $derived(authorize ?? view !== 'confirm')
  const effectiveView = $derived<SeedView>(shouldAuthorize ? view : 'confirm')

  const standaloneBound = untrack(() => externalBound)
    ? null
    : bindComponentForm(forms, seedForm, {
        prepare: async (fd) => {
          const typed = String(fd.get('seed') ?? '').trim()
          fd.set('seed', typed)
          if (typed.length >= 43 && typed.length <= 44 && nonce !== '') {
            try {
              fd.set('signature', await sign(nonce, typed))
            } catch {
              /* сервер ответит auth.signature */
            }
          }
        },
      })

  const activeForm = $derived(externalBound ?? standaloneBound!)

  // Автономный `formSteps`: когда внешний хост не передан, `SeedForm` сама
  // управляет своими срезами через `useSteps` + `formSteps`.
  const standaloneSteps = untrack(() => host)
    ? null
    : useSteps({
        owner: 'seed',
        mode: 'local',
        steps: () => [{ key: 'seed', label: 'Seed', filled: true }],
        current: () => `seed.${untrack(() => effectiveView)}`,
      })

  if (standaloneBound && standaloneSteps) {
    formSteps(standaloneBound, {
      steps: [
        { key: 'entry', label: 'Авторизация' },
        { key: 'register', label: 'Создать аккаунт' },
        { key: 'restore', label: 'Восстановление' },
        { key: 'confirm', label: 'Подтверждение владения' },
      ],
      at: 'seed',
      host: standaloneSteps,
      actionOf: (s) => {
        if (s === 'confirm') return 'confirm'
        if (s === 'restore') return 'restore'
        return 'login'
      },
    })
    mirrorToField(standaloneBound, 'nonce', () => nonce)
    mirrorToField(standaloneBound, 'seed', () => localSeed ?? seed)
  }

  $effect(() => {
    if (!standaloneSteps) return
    const target = `seed.${effectiveView}`
    untrack(() => {
      if (standaloneSteps.fullKey !== target) standaloneSteps.set(target)
    })
  })

  // Реакция на успешное подтверждение владения (`authorize={false}`, `intent="confirm"`).
  let lastConfirmedId = ''
  $effect(() => {
    if (shouldAuthorize) return
    const r = activeForm.state.result
    if (!r?.ok || r.submissionId === lastConfirmedId) return
    const data = r.data as { step?: string; confirmed?: boolean; sub?: string } | undefined
    if (data?.step === 'confirmed' || data?.confirmed) {
      lastConfirmedId = r.submissionId
      untrack(() => onConfirmed?.({ sub: data.sub }))
    }
  })
</script>

<Acl allow={shouldAuthorize ? 'guest' : 'user'} {authorized} {enabled} backHref={doneHref}>
  <Form
    id={shouldAuthorize ? 'user-auth' : 'user-seed-confirm'}
    form={activeForm}
    hiddenFields={activeForm.hidden()}
    class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left"
  >
    <Common errors={activeForm.common} title="Проверьте форму" />

    <Field of={activeForm.f.nonce} />
    <Field of={activeForm.f.signature} />

    {#if !shouldAuthorize}
      <div class="flex flex-col gap-3">
        <div class="space-y-1">
          <h2 class="text-base font-semibold">{confirmTitle}</h2>
          <p class="text-xs text-muted-foreground">{confirmDescription}</p>
        </div>
        <Field of={activeForm.f.seed} />
        <Button type="submit" name="intent" value="confirm" task={formTask(activeForm.state)}>
          {confirmLabel}
        </Button>
      </div>
    {:else if effectiveView === 'entry' || effectiveView === 'register'}
      {#if host}
        <div class="flex items-baseline justify-end gap-2">
          {#if effectiveView !== 'entry'}
            <StepLink
              {host}
              step="auth.entry"
              class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Авторизация
            </StepLink>
          {/if}
          {#if effectiveView !== 'register'}
            <StepLink
              {host}
              step="auth.register"
              class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Создать аккаунт
            </StepLink>
          {/if}
        </div>
      {/if}

      {#if effectiveView === 'register'}
        {#if localSeed}
          <div class="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p class="font-medium">Seed сгенерирован в этом браузере</p>
            <p class="text-xs text-muted-foreground">
              Ключ создан локально и не покидал ваше устройство. Сохраните его в менеджере
              секретов: он показывается один раз.
            </p>
          </div>
        {:else}
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

      <Field of={activeForm.f.seed} instead={effectiveView === 'register' ? CopyField : undefined} />

      {#if effectiveView === 'entry'}
        <Button type="submit" name="intent" value="login" task={formTask(activeForm.state)}>
          Авторизация
        </Button>
      {:else if notHydrated()}
        <Button
          type="submit"
          name="intent"
          value="login"
          variant="outline"
          task={formTask(activeForm.state)}
        >
          Создать аккаунт
        </Button>
      {:else}
        <HoldButton
          type="submit"
          name="intent"
          value="login"
          variant="outline"
          seconds={holdSeconds}
          when="fill"
          hover
          task={formTask(activeForm.state)}
        >
          Удерживайте, чтобы создать аккаунт
        </HoldButton>
      {/if}
    {:else}
      <div class="flex flex-col gap-3">
        <h2 class="text-base font-semibold">Аккаунт ждёт удаления</h2>
        <p class="text-sm text-muted-foreground">
          Вы раньше попросили удалить аккаунт, поэтому вход в него закрыт. Можно вернуть всё как
          было: заявка будет отменена, и вход продолжится. Если ничего не делать, аккаунт удалится
          сам по истечении срока.
        </p>
        <div hidden aria-hidden="true"><Field of={activeForm.f.seed} /></div>
        <Button type="submit" name="intent" value="restore" task={formTask(activeForm.state)}>
          Восстановить аккаунт
        </Button>
        <Button
          type="submit"
          name="intent"
          value="logout"
          variant="ghost"
          size="sm"
          task={formTask(activeForm.state)}
        >
          Не восстанавливать
        </Button>
      </div>
    {/if}
  </Form>
</Acl>
