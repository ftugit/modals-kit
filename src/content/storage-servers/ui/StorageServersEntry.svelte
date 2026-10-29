<script lang="ts">
  /**
   * Карточка входа в раздел серверов хранилища на главной странице —
   * рендерится реактивно по `STORAGE_ACL` (`storage.read`, `storage.edit`, `admin`).
   */
  import { grants } from '#lib/db/index.js'
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { storageServer } from '#hooks/storage-schema.js'
  import { useGrants } from '#content/user/grants.svelte.js'

  const gStorageServer = grants(storageServer)
  const asModalLink = useModalLink()
  const canRead = useGrants(gStorageServer.select)
</script>

{#if canRead.current}
  <section
    class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    data-testid="storage-servers-entry"
  >
    <h2 class="text-xl font-semibold tracking-tight">Серверы хранилища</h2>
    <p class="my-4 text-sm leading-relaxed text-muted-foreground">
      Боевой пул S3 / WebDAV для пользовательских файлов и аватаров с живой проверкой подключения перед записью.
    </p>
    <Button {...asModalLink('storage.servers')}>Открыть пул серверов</Button>
  </section>
{/if}
