<script lang="ts">
  /**
   * Страница-витрина `lib/db`. Здесь только то, что не умеют компоненты:
   * заголовок, счётчик записей, notice серверного итога и порядок блоков.
   *
   * Список — пагинатор (`DbPostsList` + `#lib/paginate/index.js`), формы — отдельные
   * компоненты `db-form/{Create,Remove}Form.svelte` (как в демо форм): `bind`,
   * `Form`, `Common`/`Field` живут там, страница отдаёт им лишь результат
   * экшена. Строки приходят SSR-снапшотом, поэтому без JavaScript видны и
   * они, и номера страниц.
   *
   * С JavaScript отправка идёт через транспорт `lib/form` (fetch на
   * `/db-demo/submit`), поэтому страница НЕ перезагружается: результат
   * применяется к форме, а список обновляет `reset` пагинатора — свежая
   * страница из источника. Нативный POST на `?/create`/`?/remove` остаётся
   * путём без JavaScript: там итог приходит `continuation`'ом.
   */
  import type { PageProps } from './$types'
  import type { Result } from '#lib/form/index.js'
  import { usePaginatorActions } from '#lib/paginate/svelte/index.js'
  import { DB_LIST_NAME, ensureDbListPaginator } from '#lib/ui/demo/db-list/definition.js'
  import DbPostsList from '#lib/ui/demo/db-list/DbPostsList.svelte'
  import { createOptimistic } from '#lib/ui/demo/db-list/optimistic.svelte.js'
  import CreateForm from '#lib/ui/demo/db-form/CreateForm.svelte'
  import RemoveForm from '#lib/ui/demo/db-form/RemoveForm.svelte'
  import SchemaPending from '#lib/ui/demo/db-form/SchemaPending.svelte'

  // `form` — результат экшена + метка «какой форме он принадлежит» (`intent`, см. +page.server);
  // тип выводит SvelteKit из `actions` (`PageProps['form']`).
  let { data, form }: PageProps = $props()

  // `form` — живой пропс: SvelteKit обнуляет его при навигации и меняет после
  // каждого экшена, поэтому результат выводится, а не копируется при монтировании.
  const action = $derived(form ?? null)

  /** Результат подсаживается ТОЙ форме, чей интент его вернул. */
  const seed = (which: string): Result | null =>
    action?.intent === which ? action.result ?? null : null

  const notice = $derived(
    action?.result?.ok ? String((action.result.data as { message?: string } | undefined)?.message ?? '') : '',
  )

  // Что делает успешная запись: обновляет источник пагинатора, а не страницу.
  // Регистрация нужна до `usePaginatorActions`: тело страницы исполняется раньше
  // тела дочернего компонента, а хост бросает «Unknown paginator» на неизвестном имени.
  ensureDbListPaginator()
  const list = usePaginatorActions(DB_LIST_NAME)
  const refreshList = () => list.reset()

  // Хранилище оптимистичных строк создаёт СТРАНИЦА: его видят и форма (пишет), и
  // список (рисует). Внутри списка или формы оно означало бы, что второй половине
  // некуда девать карточку, а на уровне модуля — общую очередь на всех посетителей.
  const optimistic = createOptimistic()

</script>

<!-- Ширина и отступы — как у остальных демо-страниц (/modals, /form). -->
<div class="mx-auto w-full max-w-4xl space-y-6 py-10 sm:py-14">
  <h1 class="text-2xl font-semibold">lib/db в SvelteKit</h1>
  <!-- Сводка (сколько записей, размер страницы, режим) живёт в `ListMeta` внутри
       хоста: после отправки формы страница не перезагружается, поэтому серверные
       цифры на этом месте остались бы вчерашними. -->

  {#if notice}
    <p class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" role="status" data-testid="notice">
      {notice}
    </p>
  {/if}

  {#if data.schema || !data.snapshot}
    {#if data.schema}<SchemaPending screen={data.schema} seed={seed('schema')} />{/if}
  {:else}
    <div class="grid gap-6 md:grid-cols-2">
      <CreateForm seed={seed('create')} onApplied={refreshList} {optimistic} />
      <RemoveForm seed={seed('remove')} onApplied={refreshList} />
    </div>

    <DbPostsList snapshot={data.snapshot} showRaw {optimistic} />
  {/if}
</div>
