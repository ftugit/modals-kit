<script lang="ts">
  /**
   * Форма фильтров списка seed-юзеров — одна на два носителя:
   *
   *  - модалка `user.list.filters` (JS): применение — патч состояния
   *    пагинатора через `onApply`, адрес не трогаем руками;
   *  - страница `/users/filters` (fallback без JS): та же форма уходит
   *    нативным GET на адрес списка (`action` + скрытые поля чужого
   *    состояния), `load` носителя разберёт параметры в тот же срез.
   *
   * Имена полей — адресные ключи пагинатора (`users.ord`, …): в нативном
   * режиме браузер сам соберёт из них адрес среза, в модальном ключи
   * срезаются до имён extra (`ord`, …) при построении патча.
   *
   * Что доступно, решает параметр `canSeeDeleted` (его посчитал домен):
   * без права на удалённые полей состояния и дат удаления в форме нет.
   */
  import { untrack } from 'svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form } from '#lib/form/svelte/index.js'
  import Field from '#components/form/Field.svelte'
  import { Button } from '#components/ui/index.js'
  import { asLink } from '#hooks/links/index.js'

  export interface SeedUsersFilterValues {
    ord: string
    state: string
    cfrom: string
    cto: string
    dfrom: string
    dto: string
  }

  interface Props {
    canSeeDeleted: boolean
    initial: SeedUsersFilterValues
    /** Нативный режим: адрес списка, куда уходит GET. */
    action?: string
    /** Чужое состояние адреса списка, которое GET обязан пронести. */
    hiddenFields?: readonly { name: string; value: string }[]
    /** Нативный режим: адрес списка без фильтров (кнопка «Сбросить»). */
    resetHref?: string
    /** Модальный режим: применение патчем extra (`undefined` — снять ключ). */
    onApply?: (patch: Record<string, string | undefined>) => void | Promise<void>
    /** Модальный режим: сброс патчем. */
    onReset?: () => void | Promise<void>
  }

  let { canSeeDeleted, initial, action, hiddenFields = [], resetHref, onApply, onReset }: Props = $props()

  // Значения — только стартовые: форма рождается под текущий срез при каждом
  // открытии, живьём их никто не меняет.
  const init = untrack(() => initial)

  const desc = defineForm({
    id: 'seed-users-filters',
    fields: {
      'users.ord': field.select({
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
        defaultValue: init.ord || 'created-desc',
      }),
      'users.state': field.select({
        label: 'Состояние',
        options: [
          { value: 'active', label: 'Только действующие' },
          { value: 'all', label: 'Включая удалённые' },
          { value: 'deleted', label: 'Только удалённые' },
        ],
        defaultValue: init.state || 'active',
      }),
      'users.cfrom': field['datetime-local']({ label: 'Создан: с', defaultValue: init.cfrom || null }),
      'users.cto': field['datetime-local']({ label: 'Создан: по', defaultValue: init.cto || null }),
      'users.dfrom': field['datetime-local']({ label: 'Удалён: с', defaultValue: init.dfrom || null }),
      'users.dto': field['datetime-local']({ label: 'Удалён: по', defaultValue: init.dto || null }),
    },
  })

  const config = createConfig({ resolve: () => undefined })
  const bound = bind(config, desc)

  let rangeError = $state('')
  const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  function submit(e: SubmitEvent) {
    const vals = bound.values as Record<string, unknown>
    const cfrom = clean(vals['users.cfrom'])
    const cto = clean(vals['users.cto'])
    const dfrom = clean(vals['users.dfrom'])
    const dto = clean(vals['users.dto'])
    if ((cfrom && cto && cfrom > cto) || (dfrom && dto && dfrom > dto)) {
      e.preventDefault()
      rangeError = 'Дата «с» позже даты «по» — поправьте диапазон'
      return
    }
    rangeError = ''
    if (!onApply) return // нативный режим: браузер сам отправит GET
    e.preventDefault()
    // Умолчания в адрес не пишем: чистый адрес = срез по умолчанию.
    void onApply({
      ord: clean(vals['users.ord']) === 'created-desc' ? undefined : clean(vals['users.ord']) || undefined,
      state: clean(vals['users.state']) === 'active' ? undefined : clean(vals['users.state']) || undefined,
      cfrom: cfrom || undefined,
      cto: cto || undefined,
      dfrom: dfrom || undefined,
      dto: dto || undefined,
    })
  }
</script>

<Form
  form={bound}
  onsubmit={submit}
  action={action}
  method={action ? 'get' : undefined}
  {hiddenFields}
  class="space-y-4"
  data-testid="seed-users-filters-form"
>
  <Field of={bound.field('users.ord')} />
  {#if canSeeDeleted}
    <Field of={bound.field('users.state')} />
  {/if}
  <div class="grid gap-3 sm:grid-cols-2">
    <Field of={bound.field('users.cfrom')} />
    <Field of={bound.field('users.cto')} />
    {#if canSeeDeleted}
      <Field of={bound.field('users.dfrom')} />
      <Field of={bound.field('users.dto')} />
    {/if}
  </div>
  {#if rangeError}
    <p class="text-sm text-destructive" role="alert">{rangeError}</p>
  {/if}
  <div class="flex items-center justify-between gap-3 pt-1">
    {#if onReset}
      <Button type="button" variant="ghost" onclick={() => void onReset()}>Сбросить</Button>
    {:else if resetHref}
      <Button {...asLink(resetHref)} variant="ghost">Сбросить</Button>
    {:else}
      <span></span>
    {/if}
    <Button type="submit">Применить</Button>
  </div>
</Form>
