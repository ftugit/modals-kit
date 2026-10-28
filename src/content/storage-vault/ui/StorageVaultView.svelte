<script lang="ts">
  import { CookieVault } from '#components/demo/index.js'
  import type { CookieVaultSnapshot } from '#hooks/cookie-vault/index.js'
  import { storageVaultSchema, type StorageVaultMeta } from '../schema.js'
  import StorageVaultForm from './StorageVaultForm.svelte'

  let {
    snapshot,
    backHref,
    onChanged,
  }: {
    snapshot: CookieVaultSnapshot<StorageVaultMeta>
    backHref?: string
    onChanged?: (next: CookieVaultSnapshot<StorageVaultMeta>) => void
  } = $props()
</script>

<CookieVault
  schema={storageVaultSchema}
  {snapshot}
  form={StorageVaultForm}
  {backHref}
  {onChanged}
>
  {#snippet renderMeta(item)}
    <span>
      лимит: <strong>{item.meta.storageMb} МБ</strong> ·
      файл до: <strong>{item.meta.fileMb} МБ</strong> ·
      split: <strong>{item.meta.allowSplit ? 'да' : 'нет'}</strong> ·
      шифрование: <strong>{item.meta.encrypted ? 'AES-256-GCM' : 'нет'}</strong> ·
      режим: <strong>{item.meta.readOnly ? 'только чтение' : 'чтение/запись'}</strong>
    </span>
  {/snippet}
</CookieVault>
