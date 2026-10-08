<script lang="ts">
  /**
   * Форма фильтров — связка «описание полей → разметка» на механизме lib/form.
   *
   * S5 (этап 5): контролы больше не собираются руками — набор полей приезжает
   * КОМПИЛЯТОРОМ схемы (`compileCatalogFilterSchema`), каждый контрол рисуется
   * из `field(key)` связки `bind`, а применение — url-контур с `live: false`:
   * форма коммит-набора, поле за полем ничего не уезжает, только «Применить»
   * (или явный `commit()` хоста). Имена полей — адресные (`page.filters.kind`),
   * канон для пути без JS и для патча с JS ОДНИ.
   *
   * Значения берутся из САМОЙ формы (`FormData` внутри `bind`), а не из
   * зеркала: одно зеркало здесь означало бы вторую правду — смена значения в
   * нативном контроле (клавиатурой, assistive-технологией, программно) не
   * обновляла бы её, и «применить» отправляло бы старое. Заодно пути «с JS» и
   * «без JS» отправляют одни и те же данные: без JS форма уходит обычным GET.
   *
   * Нарушения набора (связки, allowlist, границы числа) компилируются в те же
   * валидаторы описания, поэтому безымянный коммит показывает их ПОД ПОЛЯМИ
   * (`FieldView.errors`) до похода на сервер — а серверный список нарушений
   * остаётся правдой для пути без JS.
   */
  import { onMount } from 'svelte'
  import { compileCatalogFilterSchema, catalogFilterFieldStates, parseCatalogFilterPath } from '$lib/filters'
  import type { CatalogFilterSchema } from '$lib/filters'
  import { bind, createConfig } from '$lib/form/svelte'
  import type { FormDescription } from '$lib/form'
  import { Button, Input, Select } from '$lib/ui/primitives'

  interface Props {
    /** Схема источника: по ней компилируется описание полей (единый код-путь с сервером). */
    schema: CatalogFilterSchema
    /** Значения из состояния пагинатора (`extra`), канонические пути `filters.*`. */
    values?: Record<string, unknown> | undefined
    /** Адресный префикс: `page` → имена полей `page.filters.…` (ключи адреса). */
    prefix?: string
    /** `action` нативной формы: страница каталога (GET). */
    action?: string
    /** Чужой ключ адреса, который обязан пережить отправку формы. */
    hidden?: readonly { name: string; value: string }[]
    /** Выбор пользователя: путь поля → значения (пустые отброшены, всё одним набором). */
    onApply?: (values: Record<string, string[]>) => void
    /** Адрес «сбросить свои фильтры» (чужие ключи при этом живут). */
    resetHref?: string
    class?: string
  }

  let {
    schema,
    values,
    prefix = 'page',
    action,
    hidden = [],
    onApply,
    resetHref,
    class: cls = '',
  }: Props = $props()

  // svelte-ignore state_referenced_locally
  const namePrefix = prefix ? `${prefix}.` : ''

  // Определение полей — ОДИН раз на экземпляр: смена схемы пересоздаёт форму
  // (хост обёртывает её в {#key}). Имена — адресные ключи, относительные пути
  // остаются каноном хранилища.
  // svelte-ignore state_referenced_locally
  const compiled = compileCatalogFilterSchema(schema, `catalog-filters`, {
    namePrefix,
  })
  const desc: FormDescription = compiled.definition

  // Идентификатор контрола — его КАНОНИЧЕСКОЕ адресное имя (`page.filters.kind`)
  // (решение b1, `bd52745`): `<label for>` указывает на существующий узел, а id
  // читается так же, как имя поля. Точки в id допустимы (HTML5 запрещает только
  // пробелы), поэтому «имя = id» не переводится в другой алфавит.
  const catalogForms = createConfig({
    resolve: () => undefined,
    ui: { fieldId: (_formId, name) => name },
  })

  // Решение связки о поле (выключено + причина) — канал fieldState: он же
  // даёт FieldView.disabled/reason, и причина видна ПОД полем всегда (до
  // гидратации в том числе), а гашение контрола — работа JavaScript: без JS
  // выключенный контрол браузер не отправил бы, и запрос пользователя
  // пропал бы молча (канон `js = !hydrated`, как у панели настроек).
  // Реактивно: связки пересчитываются на каждое применение набора (extra
  // поменялся — «Оценка» при «Анонсах» гаснет сразу, как и в старом view).
  const linkOf = $derived(
    new Map(catalogFilterFieldStates(schema, values).map((state) => [state.key, state])),
  )
  function fieldState(name: string): { disabled?: boolean; reason?: string } | undefined {
    const parsed = parseCatalogFilterPath(name.slice(namePrefix.length))
    const state = parsed ? linkOf.get(parsed.key) : undefined
    return state?.disabled ? { disabled: true, reason: state.reason } : undefined
  }

  // svelte-ignore state_referenced_locally
  const form = bind(catalogForms, desc, {
    url: {
      live: false,                                 // коммит-набор: применяем целиком
      action,
      seed: (d) => {
        const out: Record<string, unknown> = {}
        for (const f of d.fields) {
          const current = values?.[f.name.slice(namePrefix.length)]
          if (current !== undefined) out[f.name] = current
        }
        return out
      },
      commit: (patch) => {
        if (!onApply) return
        const next: Record<string, string[]> = {}
        for (const [name, raw] of Object.entries(patch)) {
          const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
            .map((item) => String(item).trim())
            .filter((item) => item !== '')
          if (list.length) next[name.slice(namePrefix.length)] = list
        }
        onApply(next)
      },
    },
    fieldState,
  })

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /** Значение контрола из зеркала: списки — массивом, скаляры — первой строкой. */
  const asList = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.map((item) => String(item))
      : raw === undefined || raw === null || raw === ''
        ? []
        : String(raw).split(',').map((item) => item.trim()).filter((item) => item !== '')

  /** Пояснение «показаны не все значения» — id по образцу старых заметок. */
  const noteId = (name: string): string => `${name}-truncated`
  const truncatedOf = (f: { name: string }): number | undefined => {
    const parsed = parseCatalogFilterPath(f.name.slice(namePrefix.length))
    const field = parsed ? schema.fields.find((fd) => fd.key === parsed.key) : undefined
    return field?.type === 'multiselect' ? field.optionsTruncated : undefined
  }
</script>

<form
  {...form.formProps()}
  data-testid="catalog-filter-form"
  class={`space-y-4 ${cls}`}
>
  {#each hidden as field (field.name)}
    <input type="hidden" name={field.name} value={field.value} />
  {/each}

  <div class="grid gap-3 sm:grid-cols-2">
    {#each form.description.fields as fd (fd.name)}
      {@const v = form.field(fd.name)!}
      {@const truncated = truncatedOf(fd)}
      {@const describedby = [
        v.attrs['aria-describedby'] ?? null,
        truncated ? noteId(v.name) : null,
      ].filter(Boolean).join(' ') || undefined}
      <div class="space-y-1" data-testid="catalog-filter-field" data-filter-path={v.name.slice(namePrefix.length)}>
        <label class="block text-xs font-medium text-muted-foreground" {...v.labelProps()}>
          {v.label}
        </label>
        {#if v.input === 'select' || v.input === 'multiselect'}
          <Select
            {...(() => {
              const { value: _v, disabled: _d, 'aria-describedby': _a, ...rest } = v.attrs
              return rest
            })()}
            options={v.options ?? []}
            value={v.input === 'multiselect' ? asList(v.value) : (asList(v.value)[0] ?? '')}
            multiple={v.input === 'multiselect'}
            placeholder={v.input === 'multiselect' ? 'Не выбрано' : 'Любое'}
            aria-describedby={describedby}
            disabled={hydrated && v.disabled === true}
          />
        {:else}
          <Input
            {...(() => {
              const { disabled: _d, 'aria-describedby': _a, ...rest } = v.attrs
              return rest
            })()}
            type={v.input === 'number' ? 'number' : 'text'}
            placeholder={v.placeholder}
            aria-describedby={describedby}
            disabled={hydrated && v.disabled === true}
          />
        {/if}
        {#if truncated}
          <p
            class="text-xs text-muted-foreground"
            id={noteId(v.name)}
            data-testid="catalog-filter-truncated"
          >
            Показаны не все значения: у источника их больше на {truncated}.
          </p>
        {/if}
        {#if v.reason}
          <p
            class="text-xs text-muted-foreground"
            {...v.helpProps()}
            data-testid="catalog-filter-reason"
          >
            {v.reason}
          </p>
        {/if}
        {#each v.errors as error (error.id)}
          <p class="text-xs text-destructive" {...v.errorProps()} data-testid="catalog-filter-error">
            {error.message ?? error.code}
          </p>
        {/each}
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
