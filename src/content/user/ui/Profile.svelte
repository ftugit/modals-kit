<script lang="ts">
  /**
   * Компонент профиля: единственный, кто показывает профиль. На входе —
   * только `id` юзера; дальше он сам: запросил данные у `load` роута
   * `/user/[id]` и сам нарисовал все свои состояния — карточку, «профиль
   * не создан», ожидание. Носителям (странице и модалке) профильного
   * знать нечего: они максимум показывают `Acl`, поэтому отказ (`fact`
   * или «строки нет/не видна») компонент не рисует, а сообщает наверх
   * через `onAcl`.
   *
   * Откуда данные: страница отдаёт результат своего серверного `load`
   * пропсом `initial` (тот же роут, второй запрос не нужен, SSR/no-JS
   * целы). В модалке данные приносит загрузчик записи — тот же `load`
   * роута, — и носитель отдаёт их пропсом `route`: компонент только
   * проецирует. Собственный `preloadData` остался запасным путём на
   * случай, когда носителю приносить нечего. Поэтому разойтись «через
   * меню видно, через список нет» показ профиля не может: везде один
   * компонент, один запрос, в момент показа.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { Alert, Button, Skeleton, Surface } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import ProfileCard from './ProfileCard.svelte'
  import { useGrants } from '../grants.svelte.js'
  import {
    block as blockResource,
    config as configResource,
    profile as profileResource,
    session as sessionResource,
  } from '../schema.js'
  import { specProfile } from '../spec-profile.js'
  import type { AuthErrorCode } from '../error.js'
  import type { ProfileRead, ProfileRouteData, PublicProfileView } from '../types.js'
  import { vault } from '../vault.svelte.js'

  const gProfile = grants(profileResource)
  const gBlock = grants(blockResource)
  const gConfig = grants(configResource)
  const gSession = grants(sessionResource)

  interface Props {
    /** id аккаунта, чей профиль показать. */
    uid: string
    /** Данные `load` роута от носителя (страница): запроса не будет. */
    initial?: ProfileRead | null
    /** Публичная проекция от носителя (страница): показ без полного чтения. */
    initialPublic?: PublicProfileView | null
    /**
     * Сырой ответ `load` роута от носителя (модалка: его принёс загрузчик
     * записи). Проецируется тем же кодом, что и собственный запрос.
     */
    route?: ProfileRouteData | null
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (what: AuthErrorCode | 'not_found') => void
    /** Вариант поверхности (`'card'` на странице, `'plain'` внутри модалки). */
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    uid,
    initial = null,
    initialPublic = null,
    route = null,
    onAcl,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const asModalLink = useModalLink()
  const editProfileGrant = useGrants(gProfile.update, { ownerId: () => uid })
  const readBlocksGrant = useGrants(gBlock.select)
  const readSessionsGrant = useGrants(gSession.select)
  const readConfigGrant = useGrants(gConfig.select, { ownerId: () => uid })

  let data = $state<ProfileRead | null>(untrack(() => initial))
  const isOwnLive = $derived(
    vault.principal !== null ? vault.principal === uid : Boolean(data?.isOwn),
  )
  const canEdit = $derived(vault.principal !== null ? editProfileGrant.current : Boolean(data?.canEdit))
  const canReadSessions = $derived(
    vault.principal !== null ? readSessionsGrant.current : Boolean(data?.canReadSessions),
  )
  const canReadBlocks = $derived(
    vault.principal !== null ? readBlocksGrant.current : Boolean(data?.canReadBlocks),
  )
  const canOpenConfig = $derived(
    vault.principal !== null
      ? isOwnLive || readConfigGrant.current
      : Boolean(data?.canOpenConfig) || Boolean(data?.isOwn),
  )
  let publicData = $state<PublicProfileView | null>(untrack(() => initialPublic))
  let askedFor = ''

  /** Проекция ответа `load`: отказ — наверх носителю, публичная — в свой показ. */
  // Кнопки экрана живут в шапке `Surface`, а не в абсолютном углу и не в футере.
  // «Блокировки (N)» не ставим: чтение профиля сознательно отдаёт `blocks: []`,
  // список подгружается отдельно. Подпись правки остаётся «Редактировать» и
  // для пустого профиля — первое заполнение создаёт строку, это же ждёт SSR-тест.
  const showProfileActions = $derived(
    Boolean(data && (canEdit || isOwnLive)) ||
      Boolean(
        (data?.profile || data?.notCreated) &&
          (canOpenConfig || canReadBlocks || canReadSessions),
      ),
  )

  const project = (d: ProfileRouteData, notify = true) => {
    if (d.fact) {
      data = null
      publicData = null
      if (notify) onAcl?.(d.fact)
      return
    }
    if (d.publicProfile) {
      data = null
      publicData = d.publicProfile
      return
    }
    if (!d.profile && !d.notCreated) {
      data = null
      publicData = null
      if (notify) onAcl?.('not_found')
      return
    }
    publicData = null
    data = {
      profile: d.profile,
      isOwn: d.isOwn,
      visibility: d.visibility,
      notCreated: d.notCreated,
      canEdit: d.canEdit,
      canDeleteProfile: d.canDeleteProfile,
      canDeleteSeed: d.canDeleteSeed,
      fullBlock: d.fullBlock,
      blocks: d.blocks,
      canReadBlocks: d.canReadBlocks,
      canBlock: d.canBlock,
      canOpenConfig: d.canOpenConfig,
    }
  }

  // Модалка приносит готовый `route`, не `initial`. Проекция до первого кадра:
  // иначе клик открывает модалку со скелетоном, хотя данные уже есть.
  untrack(() => {
    if (!initial && !initialPublic && route) project(route, false)
  })

  $effect.pre(() => {
    if (initialPublic) {
      askedFor = ''
      publicData = initialPublic
      data = null
      return
    }
    if (initial) {
      askedFor = ''
      data = initial
      publicData = null
      return
    }
    // Носитель уже принёс ответ (модалка): свой запрос не нужен. Смена
    // объекта — это перезапрос загрузчика (например после правки), и
    // проекция повторяется на свежих данных.
    if (route) {
      askedFor = ''
      project(route)
      return
    }
    const id = uid
    if (!id || askedFor === id) return
    askedFor = id
    data = null
    publicData = null
    let cancelled = false
    void (async () => {
      const r = await preloadData(`/user/${id}`)
      if (cancelled || askedFor !== id) return
      if (r.type !== 'loaded') {
        // Редирект (гостя увели на вход) или сбой загрузчика: снаружи это
        // неотличимо от «строки нет/не видна» — тот же отказ носителя.
        onAcl?.('not_found')
        return
      }
      project(r.data as ProfileRouteData)
    })()
    return () => { cancelled = true }
  })
</script>

{#snippet profileActions()}
  {#if data && canEdit}
    <!-- Правка видна только с флагом чтения. Пустой профиль тоже правится:
         первое заполнение создаёт строку. Механика — пара редактирования. -->
    <Button {...asModalLink('user.profile.edit', { id: uid })} variant="outline" size="sm">
      Редактировать
    </Button>
  {/if}
  {#if isOwnLive || canReadSessions}
    <!-- Одна кнопка на свои и чужие устройства: модалка `user.sessions`
         принимает `id` аккаунта, её страница-fallback без JS — `/user/[id]/sessions`.
         Раньше чужой аккаунт вёл на страницу, и один и тот же смысл имел
         два разных носителя. -->
    <Button
      {...asModalLink('user.sessions', isOwnLive ? {} : { id: uid })}
      variant="outline"
      size="sm"
      data-testid="profile-sessions-open"
    >
      Сессии
    </Button>
  {/if}
  {#if data?.profile || data?.notCreated}
    {#if canOpenConfig}
      <Button
        {...asModalLink('user.config.edit', isOwnLive ? {} : { id: uid })}
        variant="outline"
        size="sm"
        data-testid="profile-config-open"
      >
        Настройки
      </Button>
    {/if}
    {#if canReadBlocks}
      <Button
        {...asModalLink('user.blocks', { id: uid })}
        variant="outline"
        size="sm"
        data-testid="profile-blocks-open"
      >
        Блокировки
      </Button>
    {/if}
  {/if}
{/snippet}

<Surface
  {variant}
  class={className}
  controls={showProfileActions ? profileActions : undefined}
>
  {#if data?.fullBlock}
      <!-- Полная блокировка цели: факт видят все читающие профиль, причину и
           срок чтение отдаёт только с правами (сервер решает, здесь — показ). -->
      <Alert variant="destructive" role="note" data-testid="profile-full-block" class="text-left">
        <p>
          <span class="font-semibold text-foreground">Аккаунт заблокирован</span>
          {#if data.fullBlock.reason}
            <span class="text-muted-foreground"> — {data.fullBlock.reason}</span>
          {/if}
          {#if data.fullBlock.until}
            <span class="text-muted-foreground">
              · до <time datetime={new Date(data.fullBlock.until).toISOString()}>
                {new Date(data.fullBlock.until).toLocaleDateString('ru-RU')}
              </time>
            </span>
          {/if}
        </p>
      </Alert>
    {/if}
    {#if publicData}
      <ProfileCard profile={publicData} />
    {:else if data?.profile}
      <ProfileCard profile={data.profile} />
    {:else if data?.notCreated}
      <section
        class="flex w-full flex-col items-center gap-3 py-6 text-center"
        data-testid="profile-not-created"
        data-uid={uid}
      >
        <span
          class="flex size-16 items-center justify-center rounded-full border border-border bg-muted text-xl font-semibold text-muted-foreground"
          aria-hidden="true"
        >?</span>
        <h2 class="text-lg font-semibold tracking-tight">{specProfile.notCreatedTitle}</h2>
        <p class="max-w-xs text-sm text-muted-foreground">{specProfile.notCreatedText}</p>
        <p class="text-xs text-muted-foreground">{specProfile.nicknameMissing}</p>
      </section>
    {:else}
      <!-- Собственное ожидание компонента: носителю скелет профиля не положен. -->
      <div
        class="flex w-full flex-col gap-4"
        data-testid="profile-pending"
        aria-busy="true"
      >
        <div class="flex items-center gap-4">
          <Skeleton class="size-20 shrink-0 rounded-full" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton class="h-5 w-32" />
            <Skeleton class="h-3 w-20" />
          </div>
        </div>
        <Skeleton class="h-3 w-full" />
        <Skeleton class="h-3 w-2/3" />
      </div>
    {/if}
</Surface>
