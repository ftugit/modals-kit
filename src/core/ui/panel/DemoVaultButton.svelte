<script lang="ts">
  import { Button } from '#core/ui/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import { visibleAddress } from '#core/lib/address/sveltekit.js'
  import type { DemoVaultTrigger } from '#core/ui/panel/types.js'

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
