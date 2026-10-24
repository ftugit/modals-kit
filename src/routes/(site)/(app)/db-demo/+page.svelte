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
   * С JavaScript отправка идёт через `bindComponentForm` (fetch на текущий
   * адрес, форму называет конверт), поэтому страница НЕ перезагружается:
   * результат применяется к форме, а список правится НА МЕСТЕ (`patchItems`
   * пагинатора): строка из ответа встаёт в окно, счётчики сдвигаются, выдача не
   * перезагружается. Без JavaScript тот же POST отвечает страницей с итогом
   * (`redirectOnSuccess: 'inline'` → `locals.formResult`).
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

  // Результат нативного POST (`locals.formResult` → layout) + метка «какой форме
  // он принадлежит»: id формы в конверте и есть эта метка — отдельных `actions` с
  // `intent` у маршрута больше нет.
  let { data }: PageProps = $props()

  const FORM_OF: Record<string, string> = {
    db_demo_create: 'create',
    db_demo_rename: 'rename',
    db_demo_remove: 'remove',
  }
  // Результат одноразовый: он относится к ответу, который привёл на страницу.
  // `formResult` живёт в данных layout и пережил бы клиентский переход, поэтому
  // первый же переход гасит его — как гасился `form` у прежних экшенов.
  // Результат приходит из `load` СТРАНИЦЫ (а не layout): сервер кладёт его только
  // в ответ на POST, и клиентский переход заново спрашивает load — то есть гасит
  // результат сам, как это делал пропс `form` у прежних экшенов.
  const result = $derived((data as { formResult?: Result | null }).formResult ?? null)
  const which = $derived(result ? (FORM_OF[result.formId] ?? '') : '')

  /** Результат подсаживается ТОЙ форме, чья регистрация его вернула. */
  const seed = (of: string): Result | null => (which === of ? result : null)

  // Уведомление — ТОЛЬКО путь без JavaScript: его текст лежит в `data.formResult`, а
  // его кладёт лишь ответ на нативный POST. С JS строку показывает сам список
  // (карточка из `onApplied`/`optimistic`), и второго канала «то же словами» не
  // нужно: `<Alert>` не должен спорить с тем, что уже видно. Отказ при JS — дело
  // формы (`Common`), а не страницы.
  const notice = $derived(
    result?.ok ? String((result.data as { message?: string } | undefined)?.message ?? '') : '',
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

  <div class="grid gap-6 md:grid-cols-3">
    <CreateForm seed={seed('create')} onApplied={onCreated} {optimistic} />
    <RenameForm seed={seed('rename')} onApplied={onRenamed} />
    <RemoveForm seed={seed('remove')} onApplied={onRemoved} />
  </div>

  <DbPostsList snapshot={data.snapshot} showRaw {optimistic} />
</div>
