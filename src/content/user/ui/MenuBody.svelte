<script lang="ts">
  /**
   * Тело меню пользователя — один и тот же компонент для модалки `user.menu`
   * и страницы `/user/menu`: аватар, ник, чтение своего профиля (модалка
   * `user.profile` / роут `/user/<id>`), переход к шагу редактирования
   * профиля (`stage=profile`) и выход.
   *
   * Читает исключительно единый реактивный `vault`; защищён `<Acl allow="user">`.
   */
  import { goto } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { seedForm } from './seed-form/form.js'
  import { specProfile } from '../spec-profile.js'
  import { vault } from '../vault.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from './Acl.svelte'

  interface Props {
    /** Адрес после выхода без callback (по умолчанию — главная). */
    next?: string
    /** Успех выхода (JS): закрыть модалку. Без callback — переход на `next`. */
    onDone?: () => void
    /** Вариант поверхности (`'card'` | `'plain'`). */
    variant?: UserSurfaceVariant
    /** Классы корневого блока (применяются через `cn` и к `Acl`, и к блоку меню). */
    class?: string
  }

  let {
    next = '/',
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const asModalLink = useModalLink()
  const bound = bindComponentForm(forms, seedForm)

  const nickname = $derived(vault.profile.nickname)
  const avatarUrl = $derived(vault.profile.avatarUrl)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())
  const profileLink = $derived(
    asModalLink('user.auth', { stage: 'profile' }),
  )
  // Чтение своего профиля: модалка `user.profile`, без JS — её роут
  // `/user/<id>` (`href` строит сама механика из регистрации).
  const profileViewLink = $derived(
    vault.principal ? asModalLink('user.profile', { id: vault.principal }) : null,
  )

  // Итог выхода: сервер отвечает шагом «entry» — очищаем RAM во всех вкладках
  // и зовём callback обёртки (без него — переход на `next`).
  $effect(() => {
    const state = bound.state
    if (!state.result || (state.status !== 'success' && state.status !== 'error')) return
    const data = state.result.data as { step?: string } | undefined
    if (data?.step !== 'entry') return
    untrack(() => {
      vault.clear()
      if (onDone) onDone()
      else void goto(next)
    })
  })
</script>

<Acl allow="user" {variant} class={className}>
  <div
    class={cn(
      'mx-auto flex w-full max-w-sm min-w-56 flex-col gap-3 text-left',
      userSurfaceVariants({ variant }),
      className,
    )}
  >
    <div class="flex items-center gap-3">
      <span
        class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-lg font-semibold text-muted-foreground"
      >
        {#if avatarUrl}
          <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
        {:else}
          {initial}
        {/if}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{nickname ?? specProfile.nicknameMissing}</span>
    </div>
    {#if profileViewLink}
      <Button {...profileViewLink} variant="outline" class="w-full">Профиль</Button>
    {/if}
    <Button {...profileLink} variant="outline" class="w-full">Изменить профиль</Button>
    <Form id="user-menu-logout" form={bound} hiddenFields={bound.hidden()}>
      <Button
        type="submit"
        name="intent"
        value="logout"
        variant="outline"
        task={formTask(bound.state, 'logout')}
      >
        Выйти
      </Button>
    </Form>
  </div>
</Acl>
