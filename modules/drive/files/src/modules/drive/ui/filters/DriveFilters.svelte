<script lang="ts">
  /**
   * Фильтры списка «Диска» — одна форма на sidebar, модалку и `/drive/filters`
   * (`plan-drive-repair.md` §6.3).
   *
   * С JS применение — `onApply` → `setExtra`; на отдельной странице форма
   * уходит POST и показывает стационарную квитанцию со ссылкой на список.
   * Без JS сервер собирает адрес адаптером из `from` и отвечает 303.
   * Поиск здесь не живёт: его ведёт штатный `SearchBar` списка.
   */
  import { onMount, untrack } from 'svelte'
  import { Form } from '#core/lib/form/svelte/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { asLink } from '#core/hooks/links/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import Common from '#core/ui/form/Common.svelte'
  import { Button } from '#core/ui/index.js'
  import { mirrorToField } from '#modules/user/base/svelte/field-mirror.svelte.js'
  import {
    DRIVE_FILTERS_FORM_ID,
    applyDriveFilters,
    driveFiltersForm,
    type DriveFilterValues,
  } from '../../filters-form.js'
  import { driveFiltersRoute } from '../../routes.js'

  interface Props {
    initial: DriveFilterValues
    /** Адрес списка (путь и search), куда без JS вернёт 303. */
    from: string
    /** Адрес списка без фильтров — «Сбросить» без JS. */
    resetHref?: string
    /** В чужой папке и корзине глобальная область недоступна. */
    scopeLocked?: boolean
    onApply?: (patch: Record<string, string | undefined>, pageSize: number) => void | Promise<void>
    onReset?: () => void | Promise<void>
    /** Результат нативного POST (`page.data.formResult`) при загрузке без JS. */
    form?: { result?: Result } | null
  }

  let {
    initial,
    from,
    resetHref,
    scopeLocked = false,
    onApply,
    onReset,
    form = null,
  }: Props = $props()

  const init = untrack(() => initial)
  const bound = bindComponentForm(forms, driveFiltersForm, {
    // Явный адрес операции: модалка и sidebar не должны уходить в адрес носителя.
    action: driveFiltersRoute.href(),
    continuation: untrack(() => form?.result ?? undefined),
  })
  const failed = untrack(() => Boolean(bound.state.result && !bound.state.result.ok))

  mirrorToField(bound, 'from', () => from)
  if (!failed) {
    mirrorToField(bound, 'ord', () => init.ord)
    mirrorToField(bound, 'size', () => init.size)
    mirrorToField(bound, 'type', () => init.type)
    mirrorToField(bound, 'scope', () => init.scope)
    mirrorToField(bound, 'from_date', () => init.from_date)
    mirrorToField(bound, 'to_date', () => init.to_date)
  }

  const scopeField = $derived({ ...bound.field('scope')!, disabled: scopeLocked })

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  let rangeError = $state('')

  function submit(e: SubmitEvent) {
    if (!hydrated || !onApply) return
    e.preventDefault()
    const applied = applyDriveFilters(bound.values)
    if (!applied.ok) {
      rangeError = applied.message
      return
    }
    rangeError = ''
    void onApply(applied.patch, applied.pageSize)
  }

  const doneHref = $derived.by(() => {
    if (!bound.state.result?.ok) return ''
    const value = (bound.state.result.data as { href?: unknown } | undefined)?.href
    return typeof value === 'string' ? value : ''
  })
  const done = $derived(doneHref.length > 0 && !onApply)
</script>

{#if done}
  <div class="flex flex-col gap-3" data-testid="drive-filters-done">
    <h2 class="text-base font-semibold leading-tight">Фильтры применены</h2>
    <p class="text-sm text-muted-foreground">Список откроется с выбранным срезом.</p>
    <Button {...asLink(doneHref)} variant="outline" size="sm">Открыть список</Button>
  </div>
{:else}
  <Form
    id={DRIVE_FILTERS_FORM_ID}
    form={bound}
    onsubmit={submit}
    hiddenFields={bound.hidden()}
    class="flex min-w-0 flex-col gap-4"
    data-testid="drive-filters-form"
  >
    <div hidden aria-hidden="true">
      <Field of={bound.field('paginator')!} />
      <Field of={bound.field('page_param')!} />
      <Field of={bound.field('from')!} />
    </div>
    <Common errors={bound.common} />
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="min-w-0">
        <Field of={bound.field('ord')!} />
      </div>
      <div class="min-w-0">
        <Field of={bound.field('size')!} />
      </div>
    </div>
    <Field of={bound.field('type')!} />
    <Field of={scopeField} />
    {#if scopeLocked}
      <p class="text-xs text-muted-foreground">
        «Весь диск» доступен только в своей живой папке.
      </p>
    {/if}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="min-w-0">
        <Field of={bound.field('from_date')!} />
      </div>
      <div class="min-w-0">
        <Field of={bound.field('to_date')!} />
      </div>
    </div>
    {#if rangeError}
      <p class="text-sm text-destructive" role="alert">{rangeError}</p>
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
      {#if onReset}
        <Button type="button" variant="ghost" class="max-sm:w-full" onclick={() => void onReset()}>Сбросить</Button>
      {:else if resetHref}
        <Button {...asLink(resetHref)} variant="ghost" class="max-sm:w-full">Сбросить</Button>
      {:else}
        <span></span>
      {/if}
      <Button type="submit" class="max-sm:w-full">Применить</Button>
    </div>
  </Form>
{/if}
