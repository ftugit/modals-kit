<script lang="ts">
  /**
   * `/schema` — страница экрана переноса схемы.
   *
   * Сама разметка решений — `#components/db-schema/SchemaPending.svelte` (её
   * рисует любая страница, которой нужен тот же экран); здесь только заголовок,
   * итог и ссылка возврата.
   */
  import Button from '#components/ui/button/Button.svelte'
  import SchemaPending from '#components/db-schema/SchemaPending.svelte'
  import type { Result } from '#lib/form/index.js'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  // `fail` экшена приходит в `form`: подсаживаем результат в форму один раз.
  const seed = $derived((form as { result?: Result } | null)?.result ?? null)
</script>

<div class="mx-auto w-full max-w-3xl space-y-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Перенос схемы базы</h1>
    <p class="text-sm text-muted-foreground">Экран открывается, когда изменения схемы нельзя применить сами: они могут потерять данные.</p>
  </header>

  {#if data.justDone}
    <p class="rounded-lg border border-success/40 bg-card px-4 py-3 text-sm" role="status" data-testid="schema-done">
      Перенос выполнен.
    </p>
  {/if}

  {#if data.screen}
    <SchemaPending screen={data.screen} {seed} />
  {:else}
    <p class="rounded-lg border border-success/40 bg-card px-4 py-3 text-sm" role="status" data-testid="schema-ok">
      Схема в порядке — решать нечего.
    </p>
  {/if}

  {#if data.next}
    <Button href={data.next} variant="outline">Вернуться на страницу</Button>
  {:else}
    <Button href="/db-demo" variant="outline">К демо базы данных</Button>
  {/if}
</div>
