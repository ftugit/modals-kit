<script lang="ts">
  /**
   * Модалка единицы удаления аккаунтов (`user.accounts.delete`): носитель и
   * ACL-гейт. Набор — отмеченные строки (`ids`) или срез списка (`from`).
   *
   * После успеха слой не закрывается самовольно: компонент показывает числа
   * исхода, закрывает человек.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import Acl from './Acl.svelte'
  import AccountsDelete from './accounts-delete/AccountsDelete.svelte'
  import type { AccountsDeleteRouteData } from '../types.js'
  import { userListRoute } from '../routes.js'

  const modal = useModal<{ list?: string; ids?: string; id?: string }>()
  const ldr = useLoader<AccountsDeleteRouteData>()

  const ids = $derived(
    String(modal.params?.ids ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  const listHref = userListRoute.href()
</script>

<Surface variant="plain" class="w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref={listHref} variant="plain" />
  {:else}
    <AccountsDelete
      {ids}
      sliceFields={ldr.data?.sliceFields ?? null}
      initial={ldr.data ?? null}
      doneHref={listHref}
      class="p-0"
    />
  {/if}
</Surface>
