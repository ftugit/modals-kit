<script lang="ts">
  /**
   * Прототип админки на хосте шагов: выбор пользователя списком между
   * этапами. Доказывает главное свойство новых компонентов: ни список,
   * ни профиль носитель данными не кормит — у шага маршрутного `load`
   * нет. Список сам запрашивает `/users` и работает в режиме `select`
   * (выбор — здесь, в хосте: переживает переходы между шагами), на
   * следующем шаге карточку выбранного показывает компонент профиля по
   * одному `id`. ACL по отказам обоих компонентов рисует этот носитель.
   */
  import { Steps, stepLink, useSteps } from '#components/steps/index.js'
  import Acl from './Acl.svelte'
  import Profile from './Profile.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import type { AuthErrorCode } from '../error.js'

  let selectedId = $state<string | null>(null)
  let acl = $state<AuthErrorCode | null>(null)
  let profileAcl = $state<AuthErrorCode | 'not_found' | null>(null)

  const host = useSteps({
    owner: 'user-picker',
    mode: 'local',
    key: 'upick',
    steps: () => [
      { key: 'pick', label: 'Выбор пользователя' },
      { key: 'chosen', label: 'Выбранный' },
    ],
    current: () => 'pick',
  })
</script>

<section data-testid="user-picker-steps">
  {#if acl === 'auth.forbidden' || profileAcl === 'not_found'}
    <Acl model={profileAcl === 'not_found' ? 'not_found' : 'forbidden'} backHref="/" />
  {:else if acl || profileAcl}
    <Acl status={acl ?? (profileAcl as AuthErrorCode)} backHref="/" />
  {:else}
    <Steps {host} label="Выбор пользователя" nav>
      {#snippet pick()}
        <div class="flex flex-col gap-3">
          <SeedUsersList
            mode="select"
            {selectedId}
            onSelect={(id) => (selectedId = id)}
            onAcl={(fact) => (acl = fact)}
          />
          <p class="text-sm">
            <a {...stepLink(host, 'chosen')} class="font-medium underline underline-offset-4">К выбранному →</a>
          </p>
        </div>
      {/snippet}
      {#snippet chosen()}
        <div class="flex flex-col gap-3">
          {#if selectedId}
            <Profile uid={selectedId} onAcl={(what) => (profileAcl = what)} />
          {:else}
            <p class="text-sm text-muted-foreground">Сначала выберите пользователя на шаге «Выбор пользователя».</p>
          {/if}
          <p class="text-sm">
            <a {...stepLink(host, 'pick')} class="font-medium underline underline-offset-4">← К выбору</a>
          </p>
        </div>
      {/snippet}
    </Steps>
  {/if}
</section>
