<script lang="ts">
  /** Страница переноса схемы — section-компонент (тонкий носитель в route). */
  import type { loadSchema } from './load.server.js'
  import SchemaPending from '#core/ui/db-schema/SchemaPending.svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import type { SchemaActionData } from './types.js'

  let { data, form }: { data: Awaited<ReturnType<typeof loadSchema>>; form: SchemaActionData | null } = $props()

  const seed = $derived((form as { result?: Result } | null)?.result ?? null)

  useHeadSeo({
    subTitle: 'Перенос схемы базы',
    description: 'Подтверждение и применение миграций схемы базы данных.',
    noindex: true,
  })
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
  <h1 class="text-2xl font-semibold tracking-tight">Перенос схемы базы</h1>

  {#if data.justDone}
    <p class="rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm" role="status" data-testid="schema-done">
      <span class="mr-1.5 font-semibold text-success" aria-hidden="true">✓</span>Перенос выполнен.
    </p>
  {/if}

  {#if data.screen}
    <SchemaPending screen={data.screen} {seed} />
  {:else}
    <p class="rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm" role="status" data-testid="schema-ok">
      <span class="mr-1.5 font-semibold text-success" aria-hidden="true">✓</span>Схема в порядке — решать нечего.
    </p>
  {/if}

  {#if data.next}
    <a href={data.next} class="text-sm text-primary underline">Вернуться на страницу</a>
  {:else}
    <a href="/" class="text-sm text-primary underline">На главную</a>
  {/if}
</div>
