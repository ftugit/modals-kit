<script lang="ts">
  import { Button } from '#core/ui/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'

  let { slotId, modal = 'storage.vault.delete' }: { slotId: string; modal?: string } = $props()

  const modals = tryUseModals()
  const asModalLink = modals ? useModalLink() : null
</script>

{#if asModalLink}
  <Button
    {...asModalLink(modal, { slot: slotId })}
    variant="outline"
    size="sm"
    data-testid={`vault-delete-${slotId}`}
  >
    Удалить
  </Button>
{:else}
  <Button
    variant="outline"
    size="sm"
    data-testid={`vault-delete-${slotId}`}
  >
    Удалить
  </Button>
{/if}
