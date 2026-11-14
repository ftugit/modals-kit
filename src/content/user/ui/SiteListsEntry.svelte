<script lang="ts">
  /**
   * Входы с главной в сайтовые списки (S22): журнал сессий и глобальные
   * блокировки. Видимость — по праву из `vault` (он работает и на SSR, и после
   * гидратации), адреса — из реестра маршрутов.
   *
   * Кнопка одна на два носителя: у журнала есть модалка (`useModalLink`), без JS
   * ведёт тот же адрес; у глобальных блокировок модалки нет — прямая ссылка.
   */
  import Button from '#components/ui/button/Button.svelte'
  import { asLink, useModalLink } from '#hooks/links/index.js'
  import { vault } from '../vault.svelte.js'
  import { siteListEntries } from './site-entries.js'

  const asModalLink = useModalLink()
  const entries = $derived(vault.authorized ? siteListEntries(vault.permissions) : [])
</script>

{#each entries as entry (entry.key)}
  <section
    class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    data-testid={`site-entry-${entry.key}`}
  >
    <h2 class="text-xl font-semibold tracking-tight">{entry.title}</h2>
    <p class="my-4 text-sm leading-relaxed text-muted-foreground">{entry.text}</p>
    {#if entry.modal}
      <Button {...asModalLink(entry.modal as 'user.sessions.journal')}>{entry.cta}</Button>
    {:else}
      <Button {...asLink(entry.href)}>{entry.cta}</Button>
    {/if}
  </section>
{/each}
