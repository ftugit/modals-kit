<script lang="ts">
  import { useLoader } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import ProfilesList from './ProfilesList.svelte'
  import type { AuthErrorCode } from '#modules/user/base/model/error.js'
  import type { ProfilesRouteData } from './profiles/source.js'
  import { Surface } from '#core/ui/index.js'

  const ldr = useLoader<ProfilesRouteData>()
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || effectiveAcl}
    <Acl status={effectiveAcl} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else}
    <ProfilesList
      initial={ldr.data}
      variant="plain"
      class="min-h-0 flex-1"
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</Surface>