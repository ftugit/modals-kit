<script lang="ts">
  // Разметка поиска страницы: поле, кнопки, причина выключения и тексты.
  // Логика (форма, задержка, запись в стор, сброс) — хук `usePaginatorSearch`.
  import { Form } from '#lib/form/svelte/index.js'
  import { asLink } from '#lib/components/links/index.js'
  import Button from '#lib/components/ui/button/Button.svelte'
  import { SearchInput } from '#lib/components/ui/index.js'
  import { usePaginatorSearch } from '#lib/components/paginator/index.js'

  interface Props {
    /** Имя пагинатора (оно же имя поиска: им пользуется lib search). */
    name: string
    /** Адресный ключ запроса: `page.q`. */
    path: string
    /** Текущий запрос из состояния пагинатора. */
    query?: string
    /** Запрос выключен опцией панели или источником. */
    disabled?: boolean
    /** Почему выключен: видно рядом с полем, которое не принимает ввод. */
    hint?: string
  }

  let { name, path, query, disabled = false, hint }: Props = $props()

  const LABEL = 'Поиск по каталогу'
  const PLACEHOLDER = 'Тайтл: «наруто», «naruto», «нарута»'

  // Имя и ключ фиксируются при монтаже (хук объявляет форму один раз); запрос,
  // выключение и причина читаются живыми — через функции.
  // svelte-ignore state_referenced_locally
  const search = usePaginatorSearch(name, {
    path,
    label: LABEL,
    placeholder: PLACEHOLDER,
    query: () => query,
    disabled: () => disabled,
    reason: () => hint,
  })
</script>

<!--
  GET-форма на механизме lib/form: без JS submit ведёт на `action?<path>=…`,
  SSR-лоадер отдаёт данные источника, сужённые родным поиском. С JS тем же
  ключом управляет lib search (fuzzy + коррекция) либо родной поиск источника.
-->
<Form
  form={search.form}
  hiddenFields={search.hiddenFields}
  role="search"
  data-testid="search-form"
  class="mb-3 flex flex-wrap items-center gap-2"
  onsubmit={search.submit}
>
  <!-- Крестик очистки появляется после оживления (сброс — работа JS);
       `type="search"` и прятанье родного крестика браузера — в примитиве. -->
  <SearchInput
      class="min-w-56"
      {...search.field.attrs}
      data-testid="search-input"
      disabled={search.hydrated && search.disabled}
      value={search.value}
      placeholder={PLACEHOLDER}
      aria-label={LABEL}
      clearLabel="Очистить поиск"
      title={search.disabled ? search.reason : undefined}
      oninput={search.input}
      onClear={search.clear}
      task={search.task}
    />
  {#if search.disabled && search.reason}
    <!-- Причина — последней строкой формы: рядом с полем, которое не принимает ввод. -->
    <span class="order-last w-full text-xs text-muted-foreground" data-field-hint>{search.reason}</span>
  {/if}
  <!-- С JS поле применяется само (задержка), Enter — сразу: кнопки нужны только
       до оживления и без JS. -->
  {#if !search.hydrated}
    <Button type="submit" variant="outline" data-testid="search-submit" disabled={search.disabled}>Найти</Button>
    {#if search.hasQuery}
      <Button {...asLink(search.resetHref)} variant="outline" data-testid="search-clear">Сбросить</Button>
    {/if}
  {/if}
</Form>
