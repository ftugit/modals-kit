<script lang="ts">
  /**
   * Экран чтения профиля (этапы 3+4) — единственное место, где данные
   * `load` превращаются в экран. Ветвление по исходам домена:
   *
   *  - `fact` — отказ сессии/доступа (нет входа, истёк, бан): экран `Acl`;
   *  - `profile` — строка видна: карточка чтения (`ProfileCard`, все поля);
   *  - `notCreated` — строки нет, но смотреть можно (владелец или права
   *    чтения): заглушка «профиль не создан» текстами спеки;
   *  - ни того, ни другого — строки нет ИЛИ она не видна: тот же `Acl`
   *    кодом `not_found`. Модель этих случаев не различает, а домен без
   *    прав их не различает намеренно.
   *
   * Редактирования здесь нет: оно живёт в виджете входа (`stage=profile`)
   * и вернётся в этот экран этапом 7 осознанно. Носителю (странице или
   * модалке) знать про ветвление нечего: он передаёт данные и не решает.
   */
  import { cn } from '#components/utils.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import ProfileCard from './ProfileCard.svelte'
  import { specProfile } from '../spec-profile.js'
  import type { AuthErrorCode } from '../error.js'
  import type { ProfileView } from '../types.js'

  interface Props {
    /** id аккаунта из адреса — чей профиль открыт. */
    uid: string
    profile: ProfileView | null
    notCreated?: boolean
    fact: AuthErrorCode | null
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    uid,
    profile,
    notCreated = false,
    fact,
    variant = 'plain',
    class: className,
  }: Props = $props()
</script>

{#if fact}
  <Acl status={fact} backHref="/" {variant} class={className} />
{:else if profile}
  <ProfileCard {profile} class={className} />
{:else if notCreated}
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
{:else}
  <Acl model="not_found" backHref="/" {variant} class={className} />
{/if}
