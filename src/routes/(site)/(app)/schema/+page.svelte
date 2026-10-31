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

  <!-- Обычные ссылки, а не `Button`: экран нужен и без JS, а кнопка ради двух
       переходов тянула бы вариантность в чанк маршрута. -->
  {#if data.next}
    <a href={data.next} class="text-sm text-primary underline">Вернуться на страницу</a>
  {:else}
    <a href="/" class="text-sm text-primary underline">На главную</a>
  {/if}
</div>
