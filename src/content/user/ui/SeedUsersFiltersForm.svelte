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
  import { defineForm, field, v } from '#lib/form/index.js'
  import { bind, createConfig, Form } from '#lib/form/svelte/index.js'
  import { ru } from '#components/form/messages.ru.js'
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
    /** Параметр никнейма: чекбокс, включён — true. */
    nick: boolean
    /** Размер порции списка: целое 30..100. */
    size: number
  }

  interface Props {
    canSeeDeleted: boolean
    /** Никнеймы доступны вызывающему (право на профили): параметр никнейма в форме. */
    canSeeNickname?: boolean
    initial: SeedUsersFilterValues
    /** Нативный режим: адрес списка, куда уходит GET. */
    action?: string
    /** Чужое состояние адреса списка, которое GET обязан пронести. */
    hiddenFields?: readonly { name: string; value: string }[]
    /** Нативный режим: адрес списка без фильтров (кнопка «Сбросить»). */
    resetHref?: string
    /** Модальный режим: применение патчем extra (`undefined` — снять ключ) и размером порции. */
    onApply?: (patch: Record<string, string | undefined>, pageSize: number) => void | Promise<void>
    /** Модальный режим: сброс патчем. */
    onReset?: () => void | Promise<void>
  }

  let {
    canSeeDeleted,
    canSeeNickname = false,
    initial,
    action,
    hiddenFields = [],
    resetHref,
    onApply,
    onReset,
  }: Props = $props()

  // Значения — только стартовые: форма рождается под текущий срез при каждом
  // открытии, живьём их никто не меняет.
  const init = untrack(() => initial)

  const desc = defineForm({
    id: 'seed-users-filters',
    fields: {
      // Параметр никнейма (этап 2): при правах — чекбокс столбца; опции
      // порядка по никнейму гейтятся им через `Option.when` (boolean).
      ...(untrack(() => canSeeNickname)
        ? {
            'users.nick': field.checkbox({
              label: 'Показывать никнейм',
              defaultValue: init.nick,
            }),
          }
        : {}),
      // Размер порции — не extra среза, а состояние пагинатора: модальный
      // путь применит его `setPageSize`, нативный GET унесёт `users.size`
      // в адрес списка, где его разберут роут и URL-адаптер (30..100).
      'users.size': field.number({
        label: 'Элементов на страницу',
        defaultValue: init.size || 30,
        validate: [v.required(), v.integer(), v.minValue(30), v.maxValue(100)],
      }),
      'users.ord': field.select({
        label: 'Порядок',
        options: [
          { value: 'created-desc', label: 'Сначала новые (по созданию)' },
          { value: 'created-asc', label: 'Сначала старые (по созданию)' },
          ...(untrack(() => canSeeNickname)
            ? [
                { value: 'nickname-asc', label: 'По никнейму (А→Я)', when: { field: 'users.nick', equals: true } },
                { value: 'nickname-desc', label: 'По никнейму (Я→А)', when: { field: 'users.nick', equals: true } },
              ]
            : []),
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

  const config = createConfig({ resolve: () => undefined, messages: ru })
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
    const sizeRaw = vals['users.size']
    const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
    if (!Number.isInteger(pageSize) || pageSize < 30 || pageSize > 100) {
      e.preventDefault()
      rangeError = 'Элементов на страницу — целое число от 30 до 100'
      return
    }
    rangeError = ''
    if (!onApply) return // нативный режим: браузер сам отправит GET
    e.preventDefault()
    // Умолчания в адрес не пишем: чистый адрес = срез по умолчанию.
    void onApply(
      {
        ord: clean(vals['users.ord']) === 'created-desc' ? undefined : clean(vals['users.ord']) || undefined,
        state: clean(vals['users.state']) === 'active' ? undefined : clean(vals['users.state']) || undefined,
        cfrom: cfrom || undefined,
        cto: cto || undefined,
        dfrom: dfrom || undefined,
        dto: dto || undefined,
        // Выключенный параметр в адрес не пишем; сброс зависимой опции порядка
        // на умолчание делает сам `Option.when` при изменении чекбокса.
        nick: vals['users.nick'] === true ? '1' : undefined,
      },
      pageSize,
    )
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
  <!--
    Раскладка — сегментами по образцу шапки сайта (`HeaderRowView`): ряд —
    `flex flex-wrap`, каждый пункт — гибкий сегмент `min-w-0 flex-1` с
    базовой шириной; влезли — делят ряд пополам, не влезли — второй
    сегмент сам переезжает на следующий ряд. Не grid: перенос решает
    фактическая ширина, а не брейкпоинт.
  -->
  <div class="flex flex-wrap gap-3">
    <div class="min-w-0 flex-1 basis-44" data-filter-segment="ord">
      <Field of={bound.field('users.ord')} />
    </div>
    <div class="min-w-0 flex-1 basis-44" data-filter-segment="size">
      <Field of={bound.field('users.size')} />
    </div>
  </div>
  {#if canSeeNickname}
    <Field of={bound.field('users.nick')} />
  {/if}
  {#if canSeeDeleted}
    <Field of={bound.field('users.state')} />
  {/if}
  <div class="flex flex-wrap gap-3">
    <div class="min-w-0 flex-1 basis-44" data-filter-segment="cfrom">
      <Field of={bound.field('users.cfrom')} />
    </div>
    <div class="min-w-0 flex-1 basis-44" data-filter-segment="cto">
      <Field of={bound.field('users.cto')} />
    </div>
  </div>
  {#if canSeeDeleted}
    <div class="flex flex-wrap gap-3">
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="dfrom">
        <Field of={bound.field('users.dfrom')} />
      </div>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="dto">
        <Field of={bound.field('users.dto')} />
      </div>
    </div>
  {/if}
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
