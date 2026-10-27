<script lang="ts">
  // Строка поиска пагинатора: поле `SearchInput`, no-JS submit/reset и причина выключения.
  // Логика (форма, задержка, запись в стор, сброс) — хук `usePaginatorSearch`.
  import { Form } from '#lib/form/svelte/index.js'
  import { asLink } from '#hooks/links/index.js'
  import { cn } from '#components/utils.js'
  import { Button, SearchInput } from '../../ui/index.js'
  import { usePaginatorSearch } from '../search.svelte.js'

  interface Props {
    /** Имя пагинатора (оно же имя поиска в `lib/paginate/search`). */
    name: string
    /** Текущий запрос из состояния пагинатора. */
    query?: string
    /** Запрос выключен опцией панели или возможностями источника. */
    disabled?: boolean
    /** Почему выключен: выводится рядом с полем, которое не принимает ввод. */
    hint?: string
    /** Доступная подпись поля поиска. */
    label?: string
    /** Плейсхолдер поля поиска. */
    placeholder?: string
    /** Текст кнопки очистки. */
    clearLabel?: string
    /** Классы корневого элемента формы (через `cn` к базовым, как у `Acl`). */
    class?: string
  }

  let {
    name,
    query,
    disabled = false,
    hint,
    label = 'Поиск',
    placeholder = 'Поиск…',
    clearLabel = 'Очистить поиск',
    class: className,
  }: Props = $props()

  // svelte-ignore state_referenced_locally
  const search = usePaginatorSearch(name, {
    label,
    placeholder,
    query: () => query,
    disabled: () => disabled,
    reason: () => hint,
  })
</script>

<Form
  form={search.form}
  hiddenFields={search.hiddenFields}
  role="search"
  data-testid="search-form"
  class={cn('mb-3 flex flex-wrap items-center gap-2', className)}
  onsubmit={search.submit}
>
  <SearchInput
    wrapperClass="min-w-56"
    {...search.field.attrs}
    data-testid="search-input"
    disabled={search.hydrated && search.disabled}
    value={search.value}
    {placeholder}
    aria-label={label}
    {clearLabel}
    title={search.disabled ? search.reason : undefined}
    oninput={search.input}
    onClear={search.clear}
    task={search.task}
  />
  {#if search.disabled && search.reason}
    <span class="order-last w-full text-xs text-muted-foreground" data-field-hint>{search.reason}</span>
  {/if}
  {#if !search.hydrated}
    <Button type="submit" variant="outline" data-testid="search-submit" disabled={search.disabled}>Найти</Button>
    {#if search.hasQuery && search.resetHref !== null}
      <Button {...asLink(search.resetHref)} variant="outline" data-testid="search-clear">Сбросить</Button>
    {/if}
  {/if}
</Form>
