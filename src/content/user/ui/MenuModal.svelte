<script lang="ts">
  /**
   * Меню авторизованного (`?modal=user.menu`): витрина из токена (vault) и
   * выход. Пункты управления аккаунтом (устройства, удаление) — по мере
   * появления своих экранов; выход без JS — форма на странице `/user/auth`.
   */
  import { goto } from '$app/navigation'
  import { useModals } from '#lib/modals/svelte/index.js'
  import { Button } from '#lib/components/ui/index.js'
  import { vault } from '../vault.svelte.js'

  let { data }: { data?: { next?: string | null } } = $props()

  const m = useModals()
  let busy = $state(false)

  async function logout(): Promise<void> {
    busy = true
    try {
      // выход — тот же экшен формы, конверт обязателен (слои lib/form)
      const { authEnvelope } = await import('../forms.js')
      const body = new FormData()
      for (const [k, v] of Object.entries(authEnvelope(`user-auth:${crypto.randomUUID()}`))) body.append(k, v)
      body.append('intent', 'logout')
      await fetch('/user/auth', { method: 'POST', body, headers: { accept: 'application/json' } })
      vault.clear()
      m.modals.close()
      void goto(data?.next ?? '/')
    } finally {
      busy = false
    }
  }

  const initial = $derived((vault.profile.nickname ?? '?').slice(0, 1).toUpperCase())
</script>

<div class="flex min-w-56 flex-col gap-3 p-5 text-left">
  <div class="flex items-center gap-3">
    {#if vault.profile.avatarUrl}
      <img src={vault.profile.avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
    {:else}
      <span class="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-semibold">{initial}</span>
    {/if}
    <span class="text-sm font-medium">{vault.profile.nickname ?? 'Без никнейма'}</span>
  </div>
  <Button variant="outline" disabled={busy} onclick={logout}>Выйти</Button>
</div>
