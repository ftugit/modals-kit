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
   * целы). Модалка ничего не приносит: компонент при показе сам зовёт
   * `preloadData` того же роута. Поэтому разойтись «через меню видно,
   * через список нет» показ профиля не может: везде один компонент,
   * один запрос, в момент показа.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useModalLink } from '#hooks/links/index.js'
  import ProfileCard from './ProfileCard.svelte'
  import ProfilePrivacy from './profile-privacy/ProfilePrivacy.svelte'
  import { specProfile } from '../spec-profile.js'
  import type { AuthErrorCode } from '../error.js'
  import type { ProfileRead, ProfileRouteData, PublicProfileView } from '../types.js'

  interface Props {
    /** id аккаунта, чей профиль показать. */
    uid: string
    /** Данные `load` роута от носителя (страница): запроса не будет. */
    initial?: ProfileRead | null
    /** Публичная проекция от носителя (страница): показ без полного чтения. */
    initialPublic?: PublicProfileView | null
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (what: AuthErrorCode | 'not_found') => void
    class?: string
  }

  let { uid, initial = null, initialPublic = null, onAcl, class: className }: Props = $props()

  const asModalLink = useModalLink()

  let data = $state<ProfileRead | null>(untrack(() => initial))
  let publicData = $state<PublicProfileView | null>(untrack(() => initialPublic))
  let askedFor = ''

  $effect(() => {
    if (initial) {
      data = initial
      return
    }
    const id = uid
    if (!id || askedFor === id) return
    askedFor = id
    void (async () => {
      const r = await preloadData(`/user/${id}`)
      if (askedFor !== id) return
      if (r.type !== 'loaded') {
        // Редирект (гостя увели на вход) или сбой загрузчика: снаружи это
        // неотличимо от «строки нет/не видна» — тот же отказ носителя.
        onAcl?.('not_found')
        return
      }
      const d = r.data as ProfileRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      if (d.publicProfile) {
        publicData = d.publicProfile
        return
      }
      if (!d.profile && !d.notCreated) {
        onAcl?.('not_found')
        return
      }
      data = {
        profile: d.profile,
        isOwn: d.isOwn,
        visibility: d.visibility,
        notCreated: d.notCreated,
        canEdit: d.canEdit,
        canDeleteProfile: d.canDeleteProfile,
        canDeleteSeed: d.canDeleteSeed,
        fullBlock: d.fullBlock,
      }
    })()
  })
</script>

<div class={cn('relative', className)}>
  {#if data && data.canEdit}
    <!-- Правка — справа сверху в обоих состояниях профиля: править можно
         и пустой (первое заполнение создаёт строку). Видна только с
         флагом правки чтения; механика — пара редактирования (модалка,
         без JS — её роут). -->
    <span class="absolute right-0 top-0 z-10">
      <Button {...asModalLink('user.profile.edit', { id: uid })} variant="outline" size="sm">
        Редактировать
      </Button>
    </span>
  {/if}
{#if data?.fullBlock}
  <!-- Полная блокировка цели: факт видят все читающие профиль, причину и
       срок чтение отдаёт только с правами (сервер решает, здесь — показ). -->
  <div
    class="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm"
    data-testid="profile-full-block"
    role="note"
  >
    <span class="font-medium text-destructive">Аккаунт заблокирован</span>
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
  </div>
{/if}
{#if publicData}
  <ProfileCard profile={publicData} />
{:else if data?.profile}
  <ProfileCard profile={data.profile} />
  {#if data.isOwn}
    <!-- Приватность — только в своём профиле и только владельцу: на чужом
         (даже с правом правки) компонента нет. -->
    <ProfilePrivacy level={data.visibility} class="mt-4" />
  {/if}
{:else if data?.notCreated}
  <section
    class={cn('flex w-full flex-col items-center gap-3 py-6 text-center', className)}
    data-testid="profile-not-created"
    data-uid={uid}
  >
    <span
      class="flex size-20 items-center justify-center rounded-full border border-border bg-muted text-2xl font-semibold text-muted-foreground"
      aria-hidden="true"
    >?</span>
    <h2 class="text-lg font-semibold">{specProfile.notCreatedTitle}</h2>
    <p class="max-w-xs text-sm text-muted-foreground">{specProfile.notCreatedText}</p>
    <p class="text-xs text-muted-foreground">{specProfile.nicknameMissing}</p>
  </section>
  {#if data?.isOwn}
    <ProfilePrivacy level={data.visibility} class="mt-4" />
  {/if}
{:else}
  <!-- Собственное ожидание компонента: носителю скелет профиля не положен. -->
  <div
    class={cn('flex w-full flex-col gap-4', className)}
    data-testid="profile-pending"
    aria-busy="true"
  >
    <div class="flex items-center gap-4">
      <span class="size-20 shrink-0 animate-pulse rounded-full bg-muted"></span>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <span class="h-5 w-32 animate-pulse rounded bg-muted"></span>
        <span class="h-3 w-20 animate-pulse rounded bg-muted"></span>
      </div>
    </div>
    <span class="h-3 w-full animate-pulse rounded bg-muted"></span>
    <span class="h-3 w-2/3 animate-pulse rounded bg-muted"></span>
  </div>
{/if}
</div>
