<!--
  Экран выхода (`/user/logout` и модалка `user.logout`).

  Выход — не отдельный режим, а набор сессий: снятый чекбокс закрывает одну
  текущую сессию, отмеченный раздвигает набор до всего аккаунта. Тем же
  компонентом (`ExitSteps`) закрываются устройства из списка, только там
  чекбокс работает наоборот — впускает текущую в уже показанный набор.

  Третий сценарий — локальный выход (`mode=local` в плане): куки снимаются,
  а сессия живёт. Единственный, где набор не нужен вообще: без него можно
  выйти даже тогда, когда токен протух и актора уже не прочитать.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useSteps } from '#components/steps/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { userSession, vault } from '../../vault.svelte.js'
  // Адрес экшена — из реестра, не от текущей страницы: модалка `user.logout`
  // открывается поверх любого маршрута, и относительный `./?/exit` ушёл бы
  // на страницу-носитель, где такого экшена нет (405).
  import { userLogoutRoute } from '../../routes.js'
  import { userSurfaceVariants, type UserSurfaceVariant } from '../Acl.svelte'
  import ExitSteps from '../sessions-list/ExitSteps.svelte'
  import { logoutLocalForm } from './form.js'

  interface Props {
    /** Своя текущая сессия: без неё набор собрать нельзя. */
    sessionId?: string | null
    /** Сколько активных сессий у аккаунта — им решается удержание. */
    total?: number
    /** Актор известен: набор выхода выразим. */
    canRevoke?: boolean
    /** Куда POST-ить набор (`?/exit`). */
    action?: string
    /** Куда POST-ить локальный выход (`?/local`). */
    localAction?: string
    /** Адрес возврата из подтверждения. */
    backHref?: string
    /** Носитель: страница — шаг в URL, модалка — локальный хост шагов. */
    mode?: 'page' | 'modal'
    holdSeconds?: number
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    sessionId = null,
    total = 0,
    canRevoke = true,
    action,
    localAction,
    backHref,
    mode = 'page',
    holdSeconds = 2,
    variant = 'plain',
    class: className,
  }: Props = $props()

  // Шаг: на странице — URL-ключ, в модалке — локальный хост шагов. Адрес
  // носителя в модалке не читается и не пишется; no-JS fallback ведёт на
  // страницу выхода, а не на страницу, поверх которой открыт слой.
  const stepsMode = untrack(() => mode)
  const stepKey = 'logout.step'
  const stepHost = useSteps({
    owner: 'user-logout',
    key: stepKey,
    mode: stepsMode === 'modal' ? 'local' : 'url',
    steps: () => [
      { key: 'summary', label: 'Сводка', filled: true },
      { key: 'confirm', label: 'Подтверждение', filled: true },
    ],
    current: () =>
      stepsMode === 'modal'
        ? 'summary'
        : visibleAddress().url.searchParams.get(stepKey) === 'confirm'
          ? 'confirm'
          : 'summary',
  })
  const step = $derived(stepHost.currentKey === 'confirm' ? 'confirm' : 'summary')
  const confirmHref = $derived(
    stepsMode === 'modal' ? `${userLogoutRoute.href()}?${stepKey}=confirm` : stepHost.href('confirm'),
  )

  const local = bindComponentForm(forms, logoutLocalForm, {
    action: untrack(() => localAction) ?? `${userLogoutRoute.href()}?/local`,
    session: userSession,
  })

  // Выход прошёл — сессии больше нет, держать её в памяти нельзя ни в одной
  // вкладке. Куки снял сервер, хранилище чистит клиент.
  const forget = (): void => vault.clear()
  let lastHandled: string | undefined
  $effect(() => {
    const result = local.state.result
    if (!result?.ok || result.submissionId === lastHandled) return
    lastHandled = result.submissionId
    untrack(forget)
  })

  // Набор уходит на экшен роута выхода, а не на страницу, где модалка открыта.
  const exitAction = $derived(action ?? `${userLogoutRoute.href()}?/exit`)
</script>

<div
  class={cn(
    'mx-auto flex w-full max-w-sm flex-col gap-4 text-left',
    userSurfaceVariants({ variant }),
    className,
  )}
  data-testid="logout"
>
  <div class="flex flex-col gap-1">
    <h2 class="text-lg font-semibold leading-tight tracking-tight">Выход из аккаунта</h2>
    <p class="text-sm text-muted-foreground">
      {#if canRevoke}
        Можно закрыть только это устройство или все сессии аккаунта сразу.
      {:else}
        Сессию прочитать не удалось — доступен только выход на этом устройстве.
      {/if}
    </p>
  </div>

  {#if canRevoke}
    <ExitSteps
      currentId={sessionId}
      {total}
      spread
      {step}
      {confirmHref}
      backHref={stepsMode === 'modal' ? undefined : backHref}
      onNext={stepsMode === 'modal' ? () => stepHost.set('confirm') : undefined}
      onBack={stepsMode === 'modal' ? () => stepHost.set('summary') : undefined}
      action={exitAction}
      {holdSeconds}
      heading={step === 'confirm' ? 'Подтверждение выхода' : 'Выход'}
      summary="Здесь и сейчас: завершение сессии нельзя отменить."
      confirmLabel="Выйти"
      testId="logout-exit"
      onDone={forget}
      class="border-t border-border pt-4"
    />
  {/if}

  {#if step !== 'confirm'}
    <Form
      id="user-logout-local"
      form={local}
      hiddenFields={local.hidden()}
      class="flex flex-col gap-2 border-t border-border pt-4"
    >
      <Button
        type="submit"
        name="intent"
        value="local"
        variant="outline"
        class="self-start"
        task={formTask(local.state, 'local')}
        data-testid="logout-local"
      >
        Только на этом устройстве
      </Button>
      <p class="text-xs text-muted-foreground">
        Куки удалятся, но сессия останется живой до истечения срока: вход на других устройствах
        не закроется.
      </p>
    </Form>
  {/if}
</div>
