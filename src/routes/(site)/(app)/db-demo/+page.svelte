<script lang="ts">
  /**
   * Страница-витрина `lib/db`. Здесь только то, что не умеют компоненты:
   * заголовок, счётчик записей, notice серверного итога и порядок блоков.
   *
   * Список — пагинатор (`DbPostsList` + `#lib/paginate/index.js`), формы — отдельные
   * компоненты `./{Create,Remove}Form.svelte` (как в демо форм): `bind`,
   * `Form`, `Common`/`Field` живут там, страница отдаёт им лишь результат
   * экшена. Строки приходят SSR-снапшотом, поэтому без JavaScript видны и
   * они, и номера страниц.
   *
   * С JavaScript отправка идёт через транспорт `lib/form` (fetch на
   * `/db-demo/submit`), поэтому страница НЕ перезагружается: результат
   * применяется к форме, а список правится НА МЕСТЕ (`patchItems` пагинатора):
   * строка из ответа встаёт в окно, счётчики сдвигаются, выдача не
   * перезагружается. Нативный POST на `?/create`/`?/remove` остаётся
   * путём без JavaScript: там итог приходит `continuation`'ом.
   */
  import type { PageProps } from './$types'
  import Alert from '#components/ui/alert/Alert.svelte'
  import type { Result } from '#lib/form/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import {
    DB_LIST_NAME,
    dbListExtraOf,
    ensureDbListPaginator,
    type DbPost,
  } from '#content/demo-catalog/posts/source.js'
  import DbPostsList from './DbPostsList.svelte'
  import { createOptimistic, ownRowPlacement } from './optimistic.svelte'
  import CreateForm from './CreateForm.svelte'
  import RemoveForm from './RemoveForm.svelte'
  import RenameForm from './RenameForm.svelte'
  import SchemaPending from './SchemaPending.svelte'

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

  // Регистрация нужна до `usePaginatorActions`: тело страницы исполняется раньше
  // тела дочернего компонента, а хост бросает «Unknown paginator» на неизвестном имени.
  ensureDbListPaginator()
  const list = usePaginatorActions(DB_LIST_NAME)
  const listState = usePaginatorState<DbPost>(DB_LIST_NAME)

  // Хранилище оптимистичных строк создаёт СТРАНИЦА: его видят и форма (пишет), и
  // список (рисует). Внутри списка или формы оно означало бы, что второй половине
  // некуда девать карточку, а на уровне модуля — общую очередь на всех посетителей.
  const optimistic = createOptimistic()

  /**
   * Своя запись — правка окна, а не перезагрузка выдачи: строка из ответа встаёт
   * туда, где её место по порядку, счётчики сдвигаются на один. Место неизвестно
   * без сервера (фильтр, порядок по названию) — окно не трогаем, подтверждённая
   * карточка остаётся до следующей загрузки. Строки в ответе нет — тогда и
   * только тогда слово источнику (`reset`).
   */
  function onCreated(row: DbPost | null): boolean {
    if (!row) {
      list.reset()
      return false
    }
    const at = ownRowPlacement(dbListExtraOf(listState().extra as Record<string, unknown>))
    return at ? list.patchItems<DbPost>({ insert: row, at }) : false
  }

  /**
   * Удаление — так же на месте. При фильтре запись вне окна могла и не входить в
   * выдачу: такую не считаем (счётчик поправит следующая загрузка), видимую —
   * убираем. Карточки, чья строка удалена, уходят вместе с ней: иначе убранная
   * из окна строка «воскресла» бы подтверждённой карточкой.
   */
  /**
   * Правка — тоже на месте: строка из ответа встаёт в окно (её `updated_at` уже
   * новый, поэтому опрос изменённых её повторно не пришлёт). Место в выдаче не
   * меняется: поле сортировки — `created_at`, а оно неизменяемо.
   */
  function onRenamed(row: DbPost | null): boolean {
    return row ? list.patchItems<DbPost>({ update: row }) : false
  }

  function onRemoved(ids: readonly string[]): void {
    const state = listState()
    const filtered = Boolean(dbListExtraOf(state.extra as Record<string, unknown>).flt)
    const visible = new Set(Object.values(state.pages).flat().map((r) => r.id))
    for (const id of ids) if (!filtered || visible.has(id)) list.patchItems<DbPost>({ remove: id })
    for (const card of optimistic.list()) if (card.row && ids.includes(card.row.id)) optimistic.drop(card.tmpId)
  }

</script>

<!-- Ширина и отступы — как у остальных демо-страниц (/modals, /form). -->
<div class="mx-auto w-full max-w-4xl space-y-6">
  <h1 class="text-2xl font-semibold">lib/db в SvelteKit</h1>
  <!-- Сводка (сколько записей, размер страницы, режим) живёт в `ListMeta` внутри
       хоста: после отправки формы страница не перезагружается, поэтому серверные
       цифры на этом месте остались бы вчерашними. -->

  {#if notice}
    <Alert variant="success" role="status" data-testid="notice">{notice}</Alert>
  {/if}

  {#if data.schema || !data.snapshot}
    {#if data.schema}<SchemaPending screen={data.schema} seed={seed('schema')} />{/if}
  {:else}
    <div class="grid gap-6 md:grid-cols-3">
      <CreateForm seed={seed('create')} onApplied={onCreated} {optimistic} />
      <RenameForm seed={seed('rename')} onApplied={onRenamed} />
      <RemoveForm seed={seed('remove')} onApplied={onRemoved} />
    </div>

    <DbPostsList snapshot={data.snapshot} showRaw {optimistic} />
  {/if}
</div>
