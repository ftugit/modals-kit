<script lang="ts">
  /**
   * Компонент авторизации, создания аккаунта и восстановления после удаления.
   *
   * Принимает `view: 'entry' | 'register' | 'restore'` для отрисовки нужного
   * среза UI и защищён `Acl` (`allow="guest"`): авторизованным пользователям
   * форма никогда не рендерится — вместо неё показывается экран `Acl`.
   *
   * Может работать как внутри хоста шагов (`AuthWidget` передаёт `bound` и
   * `host`), так и полностью самостоятельно на любом маршруте через
   * `bindComponentForm`.
   */
  import { untrack } from 'svelte'
  import { Form, formTask, type BoundForm } from '#lib/form/svelte/index.js'
  import { StepLink, type StepsHost } from '#lib/components/steps/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Field from '#lib/components/form/Field.svelte'
  import CopyField from '#lib/components/form/CopyField.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import HoldButton from '#lib/components/ui/button/HoldButton.svelte'
  import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import { sign } from '../keys.js'
  import { authForm } from '../forms.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import Acl from './Acl.svelte'

  export type AuthView = 'entry' | 'register' | 'restore'

  interface Props {
    /** Активный экран формы: вход, создание аккаунта или отмена удаления. */
    view: AuthView
    /** Хост шагов родителя (для `StepLink` между `auth.entry` и `auth.register`). */
    host?: StepsHost
    /** Внешняя привязка `authForm` от хоста шагов; без неё создаётся своя. */
    bound?: BoundForm
    /** Challenge nonce (при автономном использовании без внешнего `bound`). */
    nonce?: string
    /** Начальный seed при автономном использовании. */
    seed?: string
    /** Сгенерирован ли seed локально в этом браузере (для текста памятки на `register`). */
    localSeed?: string | null
    /** Длительность удержания кнопки создания аккаунта, с. */
    holdSeconds?: number
    /** Включён ли вход на сервере (`AUTH_SEAL_SECRET`). */
    enabled?: boolean
    /** Явный флаг авторизации субъекта (иначе читается из `vault` / `page.data.user`). */
    authorized?: boolean
    /** Адрес возврата на экране отказа `Acl` (`guest_only`). */
    doneHref?: string
  }

  let {
    view,
    host,
    bound: externalBound,
    nonce = '',
    seed = '',
    localSeed = null,
    holdSeconds = 2,
    enabled,
    authorized,
    doneHref = '/',
  }: Props = $props()

  const notHydrated = useJsOnly()

  const standaloneBound = untrack(() => externalBound)
    ? null
    : bindComponentForm(forms, authForm, {
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

  if (standaloneBound) {
    mirrorToField(standaloneBound, 'nonce', () => nonce)
    mirrorToField(standaloneBound, 'seed', () => localSeed ?? seed)
  }
</script>

<Acl allow="guest" {authorized} {enabled} backHref={doneHref}>
  <Form
    id="user-auth"
    form={activeForm}
    hiddenFields={activeForm.hidden()}
    class="mx-auto flex w-full max-w-sm flex-col gap-4 text-left"
  >
    <Common errors={activeForm.common} title="Проверьте форму" />

    <Field of={activeForm.f.nonce} />
    <Field of={activeForm.f.signature} />

    {#if view === 'entry' || view === 'register'}
      {#if host}
        <div class="flex items-baseline justify-end gap-2">
          {#if view !== 'entry'}
            <StepLink
              {host}
              step="auth.entry"
              class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Авторизация
            </StepLink>
          {/if}
          {#if view !== 'register'}
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

      {#if view === 'register'}
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

      <Field of={activeForm.f.seed} instead={view === 'register' ? CopyField : undefined} />

      {#if view === 'entry'}
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
