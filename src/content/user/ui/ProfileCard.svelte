<script lang="ts">
  /**
   * Карточка чтения профиля (этапы 3+4): показывает ВСЁ, что вернул
   * `ProfileView`, ничего не редактируя. Раскладка — по общепринятой
   * анатомии профиля: зона идентичности (крупный аватар, имя — заголовок,
   * под ним короткий id), ниже сгруппированные детали и времена.
   *
   * Пустые значения не прячем, а называем текстами единой спеки
   * (`specProfile`): те же строки видит строка seed-списка.
   */
  import { TimeAgo } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { specProfile } from '../spec-profile.js'
  import type { ProfileView, PublicProfileView } from '../types.js'

  interface Props {
    /** Полный вид (свои и держатели прав) или публичная проекция (чужие/гости). */
    profile: ProfileView | PublicProfileView
    /** Классы корневого блока (через `cn` к базовым). */
    class?: string
  }

  let { profile, class: className }: Props = $props()

  const full = $derived('authId' in profile ? profile : null)
  const initial = $derived((profile.nickname ?? '?').slice(0, 1).toUpperCase())
</script>

<section class={cn('flex w-full flex-col gap-4', className)} data-testid="profile-card">
  <div class="flex items-center gap-4">
    <span
      class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-2xl font-semibold text-muted-foreground"
      data-testid="profile-avatar"
    >
      {#if profile.avatarUrl}
        <img src={profile.avatarUrl} alt="" class="h-auto w-full rounded-full" />
      {:else}
        {initial}
      {/if}
    </span>
    <div class="min-w-0">
      <h2 class="truncate text-lg font-semibold" data-testid="profile-nickname">
        {profile.nickname ?? specProfile.nicknameMissing}
      </h2>
      {#if full}
        <p class="text-xs text-muted-foreground">
          Аккаунт <code title={full.authId}>{full.authId.slice(0, 8)}</code>
        </p>
      {/if}
      {#if !profile.avatarUrl}
        <p class="text-xs text-muted-foreground">{specProfile.avatarMissing}</p>
      {/if}
    </div>
  </div>

  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
    <dt class="text-muted-foreground">Никнейм</dt>
    <dd class="min-w-0 truncate" title={profile.nickname ?? undefined} data-testid="profile-field-nickname">
      {profile.nickname ?? specProfile.nicknameMissing}
    </dd>
    <dt class="text-muted-foreground">Аватар</dt>
    <dd data-testid="profile-field-avatar">{profile.avatarUrl ? 'Загружен' : specProfile.avatarMissing}</dd>
    <dt class="text-muted-foreground">Профиль создан</dt>
    <dd data-testid="profile-field-created"><TimeAgo value={profile.createdAt} /></dd>
    {#if full}
      <dt class="text-muted-foreground">Обновлён</dt>
      <dd data-testid="profile-field-updated"><TimeAgo value={full.updatedAt} /></dd>
      <dt class="text-muted-foreground">ID профиля</dt>
      <dd class="min-w-0 truncate"><code class="text-xs" title={full.id}>{full.id}</code></dd>
      <dt class="text-muted-foreground">ID аккаунта</dt>
      <dd class="min-w-0 truncate"><code class="text-xs" title={full.authId}>{full.authId}</code></dd>
    {/if}
  </dl>
</section>
