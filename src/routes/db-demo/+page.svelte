<script lang="ts">
  /**
   * Страница-витрина `lib/db`. Здесь только то, что не умеют компоненты:
   * заголовок, счётчик записей, notice серверного итога и порядок блоков.
   *
   * Список — пагинатор (`DbPostsList` + `$lib/paginate`), формы — отдельные
   * компоненты `db-form/{Create,Remove}Form.svelte` (как в демо форм): `bind`,
   * `Form`, `Common`/`Field` живут там, страница отдаёт им лишь результат
   * экшена. Строки приходят SSR-снапшотом, поэтому без JavaScript видны и
   * они, и номера страниц.
   */
  import type { PageData } from './$types'
  import type { Result } from '$lib/form'
  import DbPostsList from '$lib/ui/demo/db-list/DbPostsList.svelte'
  import CreateForm from '$lib/ui/demo/db-form/CreateForm.svelte'
  import RemoveForm from '$lib/ui/demo/db-form/RemoveForm.svelte'

  /** Результат экшена + метка «какой форме он принадлежит» (см. +page.server). */
  interface FormOutcome {
    result?: Result
    intent?: string
  }

  let { data, form }: { data: PageData; form?: FormOutcome | null } = $props()

  const action = (form ?? null) as FormOutcome | null

  /** Результат подсаживается ТОЙ форме, чей интент его вернул. */
  const seed = (which: string): Result | null =>
    action?.intent === which ? action.result ?? null : null

  const notice = $derived(
    action?.result?.ok ? String((action.result.data as { message?: string } | undefined)?.message ?? '') : '',
  )

  /** Первая строка показанной страницы — «сырая» запись как есть из слоя. */
  const rawRow = $derived(
    JSON.stringify(data.snapshot?.pages?.[data.snapshot.page]?.[0] ?? null),
  )
</script>

<h1 class="text-2xl font-semibold">lib/db в SvelteKit</h1>
<p class="text-sm text-muted-foreground">
  всего записей: <strong data-testid="total">{data.snapshot.totalItems ?? '—'}</strong>,
  размер страницы: {data.snapshot.pageSize}
</p>

{#if notice}
  <p class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" role="status" data-testid="notice">
    {notice}
  </p>
{/if}

<div class="grid gap-6 md:grid-cols-2">
  <CreateForm seed={seed('create')} />
  <RemoveForm seed={seed('remove')} />
</div>

<DbPostsList name={data.listName} snapshot={data.snapshot} raw={rawRow} />
