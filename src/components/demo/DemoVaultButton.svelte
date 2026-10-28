<script lang="ts">
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import type { DemoVaultTrigger } from './types.js'

  let { vault }: { vault: DemoVaultTrigger } = $props()

  const asModalLink = useModalLink()

  const fallbackHref = $derived.by(() => {
    const u = visibleAddress().url
    const from = (u.pathname || '/') + u.search
    const sep = vault.href.includes('?') ? '&' : '?'
    return `${vault.href}${sep}from=${encodeURIComponent(from)}`
  })
</script>

<Button
  {...asModalLink(vault.modal, vault.params ?? {}, { href: fallbackHref })}
  variant="outline"
  size="sm"
  data-testid="demo-vault-open"
>
  {vault.label ?? 'Куки-сейф'}{#if vault.count !== undefined && vault.count > 0}&nbsp;({vault.count}){/if}
</Button>
