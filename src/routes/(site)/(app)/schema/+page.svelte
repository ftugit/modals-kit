<script lang="ts">
  /**
   * `/schema` — страница экрана переноса схемы.
   *
   * Сама разметка решений — `#components/db-schema/SchemaPending.svelte` (её
   * рисует любая страница, которой нужен тот же экран); здесь только заголовок,
   * итог и ссылка возврата.
   */
  import SchemaPending from '#components/db-schema/SchemaPending.svelte'
  import { useHeadSeo } from '#components/shell/index.js'
  import type { Result } from '#lib/form/index.js'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  // `fail` экшена приходит в `form`: подсаживаем результат в форму один раз.
  const seed = $derived((form as { result?: Result } | null)?.result ?? null)

  useHeadSeo({
    subTitle: 'Перенос схемы базы',
    description: 'Подтверждение и применение миграций схемы базы данных.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-3xl space-y-6">
  <h1 class="text-2xl font-semibold">Перенос схемы базы</h1>

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

  <!-- Обычные ссылки, а не `Button`: экран нужен и без JS, а кнопка ради двух
       переходов тянула бы вариантность в чанк маршрута. -->
  {#if data.next}
    <a href={data.next} class="text-sm text-primary underline">Вернуться на страницу</a>
  {:else}
    <a href="/db-demo" class="text-sm text-primary underline">К демо базы данных</a>
  {/if}
</div>
