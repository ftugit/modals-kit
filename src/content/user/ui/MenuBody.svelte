<script lang="ts">
  /**
   * Тело меню пользователя — БУКВАЛЬНО ОДИН компонент для модалки `user.menu`
   * и страницы `/user/menu` (решение владельца, ход 261): аватар (круглый
   * блок-заполнитель, внутри картинка во всю ширину), ник, переход к
   * редактированию профиля (`user.profile` / `/user/profile`) и выход.
   */
  import { goto } from '$app/navigation'
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import { useModalLink } from '#lib/components/links/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import { authForm } from '../forms.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Снимок входа с сервера (SSR): до гидратации vault пуст. */
    server?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
    /** Адрес после выхода без callback (по умолчанию — главная). */
    next?: string
    /** Успех выхода (JS): закрыть модалку. Без callback — переход на `next`. */
    onDone?: () => void
  }

  let { server = null, next = '/', onDone }: Props = $props()

  const asModalLink = useModalLink()

  const bound = bind(forms, authForm, {
    action: '/user/auth',
    transport: kitActionTransport('/user/auth'),
  })

  const nickname = $derived(vault.profile.nickname ?? server?.prof.nickname ?? null)
  const avatarUrl = $derived(vault.profile.avatarUrl ?? server?.prof.avatarUrl ?? null)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())
  const profileLink = $derived(asModalLink('user.profile', {}, { href: '/user/profile' }))

  // Итог выхода: сервер отвечает шагом «entry» без пользователя — снимаем
  // зеркало и зовём callback обёртки (без него — переход на `next`).
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

<div class="flex min-w-56 flex-col gap-3 p-5 text-left">
  <div class="flex items-center gap-3">
    <!-- круг под размер аватара; картинка во всю ширину, высота auto, тоже
         круглая; пока её нет или она грузится — виден заполнитель -->
    <span
      class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-lg font-semibold text-muted-foreground"
    >
      {#if avatarUrl}
        <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
      {:else}
        {initial}
      {/if}
    </span>
    <span class="min-w-0 flex-1 truncate text-sm font-medium">{nickname ?? 'Без никнейма'}</span>
  </div>
  <!-- редактирование профиля — свой роут `/user/profile` (и модалка `user.profile` с JS) -->
  <Button {...profileLink} variant="outline" class="w-full">Изменить профиль</Button>
  <Form id="user-menu-logout" form={bound} hiddenFields={bound.hidden()}>
    <Button
      type="submit"
      name="intent"
      value="logout"
      variant="outline"
      class="w-full"
      task={formTask(bound.state)}
    >
      Выйти
    </Button>
  </Form>
</div>
