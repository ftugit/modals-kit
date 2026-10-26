<script lang="ts">
  /**
   * Экран профиля — единственное место в проекте, где данные профиля
   * превращаются в экран. Ветвление ровно по трём исходам `load`:
   *
   *  - `fact` — отказ сессии/доступа (нет входа, истёк, бан): экран `Acl`;
   *  - `profile` — данные есть: форма (своя или чужая — решает `subject`);
   *  - ни того, ни другого — строки нет ИЛИ она не видна: тот же `Acl`,
   *    но кодом `not_found`. Модель не различает «нет строки» и «нет прав»,
   *    поэтому и экран один.
   *
   * Носителю (странице или модалке) знать про это нечего: он передаёт
   * данные и ничего не решает.
   */
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import { ProfileForm } from './profile-form/index.js'
  import type { AuthErrorCode } from '../error.js'
  import type { ProfileScreenData, ProfileView } from '../types.js'

  interface Props {
    /** id аккаунта из адреса — чей профиль открыт. */
    uid: string
    profile: ProfileView | null
    fact: AuthErrorCode | null
    enabled?: boolean
    limits?: ProfileScreenData['limits']
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    uid,
    profile,
    fact,
    enabled,
    limits,
    variant = 'plain',
    class: className,
  }: Props = $props()
</script>

{#if fact}
  <Acl status={fact} backHref="/" {variant} class={className} />
{:else if profile}
  <ProfileForm
    subject={uid}
    initial={profile}
    {enabled}
    {limits}
    doneHref="/"
    {variant}
    class={className}
  />
{:else}
  <Acl model="not_found" backHref="/" {variant} class={className} />
{/if}
