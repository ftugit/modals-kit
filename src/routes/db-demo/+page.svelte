<script lang="ts">
  /**
   * Демо проверяет СЛОЙ БД, но форму собирает `$lib/form`: `bind` + обёртка
   * `Form` + проектный конфиг из `forms.config`. Нативный путь включён штатной
   * опцией `intercept: false` (не «свой formProps»): разметку, скрытые пары,
   * серверную валидацию и показ ошибок по-прежнему даёт библиотека, а
   * `intercept` отвечает только за то, кто отправляет — JS или браузер.
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '$lib/form/svelte'
  import type { Result } from '$lib/form'
  import { Button } from '$lib/ui/primitives'
  import { forms } from '$lib/ui/demo/form/forms.config'
  import Common from '$lib/ui/demo/form/ui/Common.svelte'
  import Field from '$lib/ui/demo/form/ui/Field.svelte'
  import { dbCreate, dbRemove } from '$lib/ui/demo/db-form/description'

  let { data, form } = $props()

  /** Результат экшена + метка «какой форме он принадлежит» (см. +page.server). */
  const action = (form ?? null) as { result?: Result; intent?: string } | null

  /**
   * `continuation` подсаживает серверный итог в связку: тогда отказ базы
   * подсвечивает то же поле теми же словами, что и клиентская проверка,
   * а не превращается в страницу фреймворка.
   */
  const seeded = (which: string): Result | null =>
    untrack(() => (action?.intent === which ? action.result ?? null : null))

  const create = bind(forms, dbCreate, {
    action: '?/create', intercept: false, live: 'on-submit', continuation: seeded('create'),
  })
  const remove = bind(forms, dbRemove, {
    action: '?/remove', intercept: false, live: 'on-submit', continuation: seeded('remove'),
  })

  const notice = $derived(
    action?.result?.ok ? String((action.result.data as { message?: string } | undefined)?.message ?? '') : '',
  )
</script>

<h1 class="text-2xl font-semibold">lib/db в SvelteKit</h1>
<p class="text-sm text-muted-foreground">
  всего записей: <strong data-testid="total">{data.totalItems}</strong>, на странице:
  {data.items.length}{data.pageSize ? ` (размер страницы ${data.pageSize})` : ''}
</p>

{#if notice}
  <p class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" role="status" data-testid="notice">
    {notice}
  </p>
{/if}

<div class="grid gap-6 md:grid-cols-2">
  <Form form={create} hiddenFields={create.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <Common errors={create.common} title="Добавление отклонено" />
    <Field of={create.f.title} />
    <Button type="submit" data-testid="create">Добавить</Button>
  </Form>

  <Form form={remove} hiddenFields={remove.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <Common errors={remove.common} title="Удаление отклонено" />
    <Field of={remove.f.ids} />
    <Button type="submit" variant="outline" data-testid="remove">Удалить</Button>
  </Form>
</div>

<table class="w-full text-sm" data-testid="rows">
  <thead>
    <tr class="text-left text-muted-foreground">
      <th>id — скопируйте в поле удаления</th>
      <th>title</th>
      <th>created_at</th>
    </tr>
  </thead>
  <tbody>
    {#each data.items as row (String(row.id))}
      <tr class="border-t border-border">
        <td><code>{String(row.id ?? '')}</code></td>
        <td>{row.title ?? ''}</td>
        <td>{row.created_at ?? ''}</td>
      </tr>
    {/each}
  </tbody>
</table>

<pre class="overflow-auto rounded-lg bg-muted p-3 text-xs" data-testid="raw">{JSON.stringify(data.items[0] ?? null)}</pre>
