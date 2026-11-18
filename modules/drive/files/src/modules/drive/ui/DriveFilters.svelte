<script lang="ts">
  /**
   * Фильтры списка `/drive` — обычная GET-форма: адрес читается загрузчиком,
   * серверный экшен не нужен. Курсор `drive.after` форма не несёт: смена
   * фильтра всегда начинает список заново.
   */
  import { untrack } from 'svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Button } from '#core/ui/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import type { DriveSort } from '#core/lib/drive/index.js'
  import { driveFiltersForm } from '../form.js'
  import { driveFiltersDirty } from '../source.js'

  interface Props {
    pathname: string
    search: string | null
    type: 'all' | 'file' | 'folder'
    sort: DriveSort
    starred: boolean
    pageSize: number
    from: string | null
    to: string | null
  }

  let { pathname, search, type, sort, starred, pageSize, from, to }: Props = $props()

  const init = untrack(() => ({ pathname, search, type, sort, starred, pageSize, from, to }))
  const dirty = untrack(() => driveFiltersDirty(init))
  const form = bind(forms, driveFiltersForm(init), {
    // URL-режим: GET-форма не несёт конверт `__form_*` и не перехватывается JS.
    url: true,
    action: init.pathname,
    instance: 'drive:filters',
    intercept: false,
  })
</script>

<Form
  {form}
  method="get"
  action={init.pathname}
  class="mb-4 flex flex-wrap items-end gap-2"
  data-testid="drive-filters"
>
  <div class="min-w-40 flex-1"><Field of={form.f['drive.q']} /></div>
  <Field of={form.f['drive.ord']} />
  <Field of={form.f['drive.type']} />
  <Field of={form.f['drive.size']} />
  <Field of={form.f['drive.from']} />
  <Field of={form.f['drive.to']} />
  <Field of={form.f['drive.starred']} />
  <div class="flex items-center gap-2">
    <Button type="submit" size="sm">Применить</Button>
    {#if dirty}
      <Button href={init.pathname} variant="ghost" size="sm">Сбросить</Button>
    {/if}
  </div>
</Form>
