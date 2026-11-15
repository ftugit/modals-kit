<script lang="ts">
  /**
   * Единый вход в пользовательские списки на главной (план §2.1).
   *
   * Права: кнопка «Профили» намеренно публична (доступна любому,
   * включая гостя); экран списка сам выдаёт `Acl` при отказе. В отличие
   * от неё, входы «Сессии»/«Блокировки» из `siteListEntries` —
   * permission-gated и рендерятся только при праве читать соответствующую
   * модель (см. `site-entries.ts`). Смешанная политика видимости —
   * сознательная: профили — публичный каталог, сессии/блокировки —
   * операторские инструменты.
   */
  import Button from '#components/ui/button/Button.svelte'
  import { asLink, useModalLink } from '#hooks/links/index.js'
  import { vault } from '../vault.svelte.js'
  import type { SiteListEntry } from './site-entries.js'

  interface Props {
    entries: readonly SiteListEntry[]
  }

  let { entries }: Props = $props()

  const asModalLink = useModalLink()
  const authorized = $derived(vault.authorized)
</script>

<section
  class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
  data-testid="user-entries"
>
  <h2 class="text-xl font-semibold tracking-tight">Пользователь</h2>
  <p class="my-4 text-sm leading-relaxed text-muted-foreground">
    Входы в списки аккаунтов, сессий и блокировок. Видимость кнопок определяется правами.
  </p>
  <div class="flex flex-wrap gap-2">
    {#if authorized}
      <Button {...asModalLink('user.list')}>Seed-юзеры</Button>
    {/if}
    <Button {...asModalLink('user.profiles')}>Профили</Button>
    {#each entries as entry (entry.key)}
      {#if entry.modal}
        <Button {...asModalLink(entry.modal as 'user.sessions.journal')}>{entry.cta}</Button>
      {:else}
        <Button {...asLink(entry.href)}>{entry.cta}</Button>
      {/if}
    {/each}
  </div>
</section>
