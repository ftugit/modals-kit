<script lang="ts">
  /**
   * Точка входа в «Диск» на главной — только для авторизованных.
   *
   * Видимость — по факту входа (`vault.authorized`), как у `SeedUsersEntry`:
   * гостю блок не нужен. Права на сам список проверяет экран `/drive`.
   */
  import Button from '#core/ui/button/Button.svelte'
  import { useModalLink } from '#core/hooks/links/index.js'
  import { vault } from '#modules/user/base/svelte/vault.svelte.js'

  const asModalLink = useModalLink()
  const authorized = $derived(vault.authorized)
</script>

{#if authorized}
  <section
    class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    data-testid="drive-entry"
  >
    <h2 class="text-xl font-semibold tracking-tight">Диск</h2>
    <p class="my-4 text-sm leading-relaxed text-muted-foreground">
      Папки и файлы с квотой, корзиной и доступом; можно смонтировать по WebDAV.
    </p>
    <Button {...asModalLink('drive.browse')}>Открыть диск</Button>
  </section>
{/if}
