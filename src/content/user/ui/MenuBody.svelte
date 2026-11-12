<script lang="ts">
  /**
   * Тело меню пользователя — один и тот же компонент для модалки `user.menu`
   * и страницы `/user/menu`: аватар, ник, чтение своего профиля (модалка
   * `user.profile` / роут `/user/<id>`), переход к шагу редактирования
   * профиля (`stage=profile`) и выход.
   *
   * Читает исключительно единый реактивный `vault`; защищён `<Acl allow="user">`.
   */
  import { grants } from '#lib/db/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { storageServer } from '#hooks/storage-schema.js'
  import { Button, Separator } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useGrants } from '../grants.svelte.js'
  import { specProfile } from '../spec-profile.js'
  import { vault } from '../vault.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from './Acl.svelte'

  interface Props {
    /** Вариант поверхности (`'card'` | `'plain'`). */
    variant?: UserSurfaceVariant
    /** Классы корневого блока (применяются через `cn` и к `Acl`, и к блоку меню). */
    class?: string
  }

  let {
    variant = 'plain',
    class: className,
  }: Props = $props()

  const asModalLink = useModalLink()

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
  const configLink = $derived(asModalLink('user.config.edit'))
  const storageServersGrant = useGrants(grants(storageServer).select)
  const storageServersLink = $derived(asModalLink('storage.servers'))
</script>

<Acl allow="user" {variant} class={className}>
  <div
    class={cn(
      'mx-auto my-auto flex w-full max-w-sm min-w-56 flex-col gap-1.5 text-left',
      userSurfaceVariants({ variant }),
      className,
    )}
  >
    <div class="flex items-center gap-2.5 px-2 py-1.5">
      <span
        class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground"
      >
        {#if avatarUrl}
          <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
        {:else}
          {initial}
        {/if}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{nickname ?? specProfile.nicknameMissing}</span>
    </div>
    <Separator />
    <div class="flex flex-col gap-0.5">
      {#if profileViewLink}
        <Button {...profileViewLink} variant="ghost" size="sm" class="w-full justify-start font-normal">
          Профиль
        </Button>
      {/if}
      <Button
        {...asModalLink('user.sessions')}
        variant="ghost"
        size="sm"
        class="w-full justify-start font-normal"
        data-testid="menu-sessions-open"
      >
        Сессии
      </Button>
      <Button {...profileLink} variant="ghost" size="sm" class="w-full justify-start font-normal">
        Изменить профиль
      </Button>
      <Button
        {...configLink}
        variant="ghost"
        size="sm"
        class="w-full justify-start font-normal"
        data-testid="menu-config-open"
      >
        Настройки
      </Button>
      {#if storageServersGrant.current}
        <Button
          {...storageServersLink}
          variant="ghost"
          size="sm"
          class="w-full justify-start font-normal"
          data-testid="menu-storage-servers-open"
        >
          Серверы хранилища
        </Button>
      {/if}
    </div>
    <Separator />
    <!-- Без своего `onclick`: всплывашка закрывается, когда открывается
         модалка, — так же, как у остальных пунктов меню. Свой обработчик
         закрывал поповер первым (делегированный клик срабатывает раньше
         вложения ссылки), элемент размонтировался, и выход не открывался
         вовсе. -->
    <Button
      {...asModalLink('user.logout')}
      variant="ghost"
      size="sm"
      class="w-full justify-start font-normal"
      data-testid="menu-logout-open"
    >
      Выйти
    </Button>
  </div>
</Acl>
