<script lang="ts">
  /**
   * Фильтры списка seed-юзеров (`user.list.filters`, модалка без route —
   * адрес ей не нужен, открывается только кнопкой над списком).
   *
   * Форма — клиентская: серверного действия у фильтров нет, результат —
   * патч состояния пагинатора (`setExtra` по объявленным ключам источника).
   * Значения сеются из текущего набора пагинатора при открытии; применение
   * пишет набор и закрывает модалку, список перезапрашивается с первой
   * порции тем же `load`, что кормит SSR (одна точка доступа к данным).
   *
   * Что доступно, решает не компонент, а параметр открытия `canSeeDeleted`
   * (его посчитал домен): без права на удалённые полей состояния и дат
   * удаления в форме нет.
   */
  import { untrack } from 'svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form } from '#lib/form/svelte/index.js'
  import Field from '#components/form/Field.svelte'
  import { Button } from '#components/ui/index.js'
  import { getClientStore, setExtra } from '#lib/paginate/index.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { useModal, useModals } from '#lib/modals/svelte/index.js'
  import { SEED_USERS_NAME } from './seed-users/source.js'

  const m = useModals()
  const modal = useModal<{ canSeeDeleted?: boolean }>()
  const canSeeDeleted = $derived(modal.params.canSeeDeleted === true)

  const pagState = usePaginatorState(SEED_USERS_NAME)
  const initial = untrack(() => {
    const e = (pagState().extra ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'active',
      cfrom: s('cfrom'),
      cto: s('cto'),
      dfrom: s('dfrom'),
      dto: s('dto'),
    }
  })

  const desc = defineForm({
    id: 'seed-users-filters',
    fields: {
      ord: field.select({
        label: 'Порядок',
        options: [
          { value: 'created-desc', label: 'Сначала новые (по созданию)' },
          { value: 'created-asc', label: 'Сначала старые (по созданию)' },
          ...(untrack(() => canSeeDeleted)
            ? [
                { value: 'deleted-desc', label: 'Недавно удалённые (по удалению)' },
                { value: 'deleted-asc', label: 'Давно удалённые (по удалению)' },
              ]
            : []),
          { value: 'id-asc', label: 'По id: по возрастанию' },
          { value: 'id-desc', label: 'По id: по убыванию' },
        ],
        defaultValue: initial.ord,
      }),
      state: field.select({
        label: 'Состояние',
        options: [
          { value: 'active', label: 'Только действующие' },
          { value: 'all', label: 'Включая удалённые' },
          { value: 'deleted', label: 'Только удалённые' },
        ],
        defaultValue: initial.state,
      }),
      cfrom: field['datetime-local']({ label: 'Создан: с', defaultValue: initial.cfrom || null }),
      cto: field['datetime-local']({ label: 'Создан: по', defaultValue: initial.cto || null }),
      dfrom: field['datetime-local']({ label: 'Удалён: с', defaultValue: initial.dfrom || null }),
      dto: field['datetime-local']({ label: 'Удалён: по', defaultValue: initial.dto || null }),
    },
  })

  const config = createConfig({ resolve: () => undefined })
  const bound = bind(config, desc)

  let rangeError = $state('')

  const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  async function apply(e: SubmitEvent) {
    e.preventDefault()
    const vals = bound.values as Record<string, unknown>
    const cfrom = clean(vals.cfrom)
    const cto = clean(vals.cto)
    const dfrom = clean(vals.dfrom)
    const dto = clean(vals.dto)
    if ((cfrom && cto && cfrom > cto) || (dfrom && dto && dfrom > dto)) {
      rangeError = 'Дата «с» позже даты «по» — поправьте диапазон'
      return
    }
    rangeError = ''
    // Умолчания в адрес не пишем: чистый URL = срез по умолчанию.
    const patch: Record<string, string | undefined> = {
      ord: clean(vals.ord) === 'created-desc' ? undefined : clean(vals.ord) || undefined,
      state: clean(vals.state) === 'active' ? undefined : clean(vals.state) || undefined,
      cfrom: cfrom || undefined,
      cto: cto || undefined,
      dfrom: dfrom || undefined,
      dto: dto || undefined,
    }
    await setExtra(getClientStore(), SEED_USERS_NAME, patch)
    m.modals.close()
  }

  async function reset() {
    await setExtra(getClientStore(), SEED_USERS_NAME, {
      ord: undefined,
      state: undefined,
      cfrom: undefined,
      cto: undefined,
      dfrom: undefined,
      dto: undefined,
    })
    m.modals.close()
  }
</script>

<div class="p-5">
  <h2 class="mb-4 text-base font-semibold">Фильтры списка</h2>
  <Form form={bound} onsubmit={apply} class="space-y-4" data-testid="seed-users-filters-form">
    <Field of={bound.field('ord')} />
    {#if canSeeDeleted}
      <Field of={bound.field('state')} />
    {/if}
    <div class="grid gap-3 sm:grid-cols-2">
      <Field of={bound.field('cfrom')} />
      <Field of={bound.field('cto')} />
      {#if canSeeDeleted}
        <Field of={bound.field('dfrom')} />
        <Field of={bound.field('dto')} />
      {/if}
    </div>
    {#if rangeError}
      <p class="text-sm text-destructive" role="alert">{rangeError}</p>
    {/if}
    <div class="flex items-center justify-between gap-3 pt-1">
      <Button type="button" variant="ghost" onclick={reset}>Сбросить</Button>
      <Button type="submit">Применить</Button>
    </div>
  </Form>
</div>
