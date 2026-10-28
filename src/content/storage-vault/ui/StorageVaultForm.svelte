<script lang="ts">
  /**
   * UI-компонент формы добавления/обновления S3-сервера для экземпляра `storageVaultSchema`
   * (по аналогии с `RickMortyFilters.svelte`: поля расставлены вручную под свою схему).
   */
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { Button } from '#components/ui/index.js'
  import {
    bindCookieVault,
    type CookieVaultFormProps,
  } from '#hooks/cookie-vault/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { StorageVaultMeta } from '../schema.js'

  let props: CookieVaultFormProps<StorageVaultMeta> = $props()
  const vault = bindCookieVault(() => props)
</script>

<Form form={vault.form} hiddenFields={vault.hidden()} class="space-y-3" data-testid="storage-vault-entry-form">
  <h3 class="text-sm font-semibold">Добавить или обновить S3-сервер</h3>
  <Common errors={vault.common} />

  <Field of={vault.f.slot} />
  <Field of={vault.f.url} />
  <Field of={vault.f.encryption_key} />

  <div class="grid gap-3 sm:grid-cols-2">
    <Field of={vault.f.storage_mb} />
    <Field of={vault.f.file_mb} />
  </div>

  <Field of={vault.f.allow_split} />
  <Field of={vault.f.read_only} />

  <div class="flex items-center gap-3 pt-1">
    <Button type="submit" task={formTask(vault.state)} data-testid="vault-save-submit">
      Сохранить в куки
    </Button>
  </div>
</Form>
