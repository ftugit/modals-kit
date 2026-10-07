<script lang="ts">
  /**
   * Форма фильтров — только разметка.
   *
   * Что она НЕ делает (и почему): не знает ни ключей фильтров, ни схемы, ни
   * источника, ни адреса. Контролы приходят готовыми (`catalogFilterView`), а
   * выбор уезжает наружу словарём «путь поля → значения». Проверка значений,
   * отсечение чужого, связки и патч хранилища живут в `$lib/filters` — поэтому
   * вторая реализация (React/SolidJS) повторяет эту разметку, а не логику: у
   * неё те же `controls`, тот же `formAction` и тот же контракт `onApply`.
   *
   * Значения берутся из САМОЙ формы (`FormData`), а не из зеркала состояния:
   * контролы — нативные (`select`/`input`), и браузер уже хранит выбор в них.
   * Одно зеркало здесь означало бы вторую правду: смена значения в нативном
   * контроле (клавиатурой, assistive-технологией, программно) не обновляла бы
   * её, и «применить» отправляло бы старое. Заодно пути «с JS» и «без JS»
   * отправляют одни и те же данные — без JS форма уходит обычным GET.
   *
   * Без JavaScript форма работает целиком: имена полей канонические
   * (`page.filters.<поле>.<режим>`), чужие ключи адреса едут скрытыми полями.
   * Ровно эти ключи читает адресный слой после перехода.
   */
  import { onMount } from 'svelte'
  import { Button, Input, Select } from '$lib/ui/primitives'
  import type { CatalogFilterControl } from '$lib/filters'

  interface Props {
    controls: readonly CatalogFilterControl[]
    /** `action` нативной формы: страница каталога (GET). */
    action?: string
    /** Чужой ключ адреса, который обязан пережить отправку формы. */
    hidden?: readonly { name: string; value: string }[]
    /** Выбор пользователя: путь поля → значения. */
    onApply?: (values: Record<string, string[]>) => void
    /** Адрес «сбросить свои фильтры» (чужие ключи при этом живут). */
    resetHref?: string
    class?: string
  }

  let { controls, action, hidden = [], onApply, resetHref, class: cls = '' }: Props = $props()

  let formEl = $state<HTMLFormElement | null>(null)

  /**
   * Гашение недоступных полей — работа JavaScript, а не разметки: без JS форму
   * нельзя «подкручивать» (выключенный контрол браузер не отправляет, и запрос
   * пользователя пропал бы молча). До гидратации поля остаются живыми, а
   * причина (««Статус» блокирует поле: …») видна всегда — там же говорит
   * валидатор связок. Канон тот же, что у панели настроек (`js = !hydrated`).
   */
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /**
   * Значения одного контрола из формы. Числовая граница и одиночный выбор —
   * одно значение, мультивыбор — список (нативный `select multiple` шлёт их
   * под одним именем). Пустые значения отбрасываются: «ничего не выбрано» —
   * это снятие ключа, а не значение с пустой строкой.
   */
  function read(data: FormData, control: CatalogFilterControl): string[] {
    return data
      .getAll(control.name)
      .map((item) => String(item).trim())
      .filter((item) => item !== '')
  }

  /**
   * Идентификатор контрола: `catalog-filter-` + имя поля, точки — дефисами.
   * Правило то же, что у адаптера форм проекта (`defaultUi.fieldId`), чтобы
   * `<label for>` указывал на существующий узел. Несущий это правило узел —
   * нативный контрол: у `Select` он же и есть поле формы, а видимый «триггер»
   * — рисунок (`aria-hidden`, `tabindex="-1"`).
   */
  const idOf = (control: CatalogFilterControl): string =>
    `catalog-filter-${control.name.replace(/\./g, '-')}`

  /** Идентификатор пояснения к полю: причина связки или усечённый список. */
  const noteId = (control: CatalogFilterControl, kind: 'reason' | 'more'): string =>
    `${idOf(control)}-${kind}`

  /** Связи доступности: подсказка поля — то, что реально нарисовано рядом. */
  function describedBy(control: CatalogFilterControl): string | undefined {
    const ids: string[] = []
    if (control.kind === 'multiselect' && control.truncated) ids.push(noteId(control, 'more'))
    if (control.disabled && control.reason) ids.push(noteId(control, 'reason'))
    return ids.length ? ids.join(' ') : undefined
  }

  function submit(event: SubmitEvent) {
    if (!onApply) return
    const form = formEl ?? (event.currentTarget as HTMLFormElement)
    event.preventDefault()
    const data = new FormData(form)
    const values: Record<string, string[]> = {}
    for (const control of controls) {
      // Выключенный контрол браузер не отправляет и сам — но его значение
      // («выключено» не равно «пусто») наружу уходить не должно ни при каком
      // пути, поэтому и здесь оно не читается.
      if (control.disabled) continue
      const items = read(data, control)
      if (items.length) values[control.path] = items
    }
    onApply(values)
  }
</script>

<form
  bind:this={formEl}
  method="get"
  action={action}
  onsubmit={submit}
  data-testid="catalog-filter-form"
  class={`space-y-4 ${cls}`}
>
  {#each hidden as field (field.name)}
    <input type="hidden" name={field.name} value={field.value} />
  {/each}

  <div class="grid gap-3 sm:grid-cols-2">
    {#each controls as control (control.path)}
      <div class="space-y-1" data-testid="catalog-filter-field" data-filter-path={control.path}>
        <label class="block text-xs font-medium text-muted-foreground" for={idOf(control)}>
          {control.label}
        </label>
        {#if control.kind === 'select'}
          <Select
            id={idOf(control)}
            aria-describedby={describedBy(control)}
            options={control.options}
            name={control.name}
            value={control.value}
            disabled={hydrated && control.disabled}
            placeholder="Любое"
          />
        {:else if control.kind === 'multiselect'}
          <Select
            id={idOf(control)}
            aria-describedby={describedBy(control)}
            options={control.options}
            name={control.name}
            multiple
            value={[...control.value]}
            disabled={hydrated && control.disabled}
            placeholder="Не выбрано"
          />
        {:else if control.kind === 'number'}
          <Input
            id={idOf(control)}
            aria-describedby={describedBy(control)}
            type="number"
            name={control.name}
            value={control.value}
            placeholder={control.placeholder}
            min={control.min}
            max={control.max}
            disabled={hydrated && control.disabled}
          />
        {:else}
          <Input
            id={idOf(control)}
            aria-describedby={describedBy(control)}
            type="text"
            name={control.name}
            value={control.value}
            disabled={hydrated && control.disabled}
          />
        {/if}
        {#if control.kind === 'multiselect' && control.truncated}
          <p
            class="text-xs text-muted-foreground"
            id={noteId(control, 'more')}
            data-testid="catalog-filter-truncated"
          >
            Показаны не все значения: у источника их больше на {control.truncated}.
          </p>
        {/if}
        {#if control.disabled && control.reason}
          <p
            class="text-xs text-muted-foreground"
            id={noteId(control, 'reason')}
            data-testid="catalog-filter-reason"
          >
            {control.reason}
          </p>
        {/if}
      </div>
    {/each}
  </div>

  <div class="flex flex-wrap items-center justify-end gap-2">
    {#if resetHref}
      <a
        href={resetHref}
        data-testid="catalog-filter-reset"
        class="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        Сбросить
      </a>
    {/if}
    <Button type="submit" size="sm" data-testid="catalog-filter-submit">Применить</Button>
  </div>
</form>
