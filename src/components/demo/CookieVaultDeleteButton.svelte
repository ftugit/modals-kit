<script lang="ts">
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { STORAGE_VAULT_DELETE_MODAL } from '#content/storage-vault/modals.js'

  let { slotId }: { slotId: string } = $props()

  const asModalLink = useModalLink()
</script>

<Button
  {...asModalLink(STORAGE_VAULT_DELETE_MODAL, { slot: slotId })}
  variant="outline"
  size="sm"
  data-testid={`vault-delete-${slotId}`}
>
  Удалить
</Button>
