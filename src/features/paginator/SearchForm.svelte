<script lang="ts">
  // Поле поиска раздела: подпись + GET-форма (как у страницы Shikimori исходника).
  //
  // Без JavaScript форма работает нативно: `action` — текущий путь, поле едет
  // ключом `<pageParam>.q`, все остальные ключи адреса (страница, размер, опции
  // пагинатора и даже чужие пагинаторы — галерея) сохраняются скрытыми полями.
  // С JavaScript тот же сабмит идёт в пагинатор (lib search: смена `q` = сброс
  // на страницу 1 и перезагрузка через источник), без перезагрузки страницы.
  import { normalizeSearchQuery } from '$lib/search/core'
  import { currentPathname, currentSearch } from '$lib/router/sveltekit'
  import { buttonVariants } from '$lib/ui/primitives'

  interface Props {
    /** Базовый ключ пагинатора: запрос живёт как `<pageParam>.q` (как у lib search). */
    pageParam?: string
    label: string
    hint?: string
    /** Текущее значение запроса (из extra пагинатора). */
    value: string
    /**
     * Поиск выключен (оболочка сказала «у источника/по тумблеру поиска нет»):
     * форма ВИДНА, но не принимает ввод — выключенное не прячем.
     */
    disabled?: boolean
    commit: (value: string) => void
    class?: string
  }

  let { pageParam = 'page', label, hint, value, disabled = false, commit, class: className }: Props = $props()

  const preserved = $derived.by((): [string, string][] => {
    const qKey = `${pageParam}.q`
    return Object.entries(currentSearch())
      .filter(([key]) => key !== qKey)
      .map(([key, raw]) => [key, String(raw)] as [string, string])
  })

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const raw = new FormData(form).get(`${pageParam}.q`)
    commit(normalizeSearchQuery(String(raw ?? '')))
  }
</script>

<form
  method="get"
  action={currentPathname()}
  data-testid="search-form"
  class={`flex flex-wrap items-end gap-2 ${className ?? ''}`}
  onsubmit={onSubmit}
>
  {#each preserved as [key, raw] (key + '=' + raw)}
    <input type="hidden" name={key} value={raw} />
  {/each}
  <label class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
    {label}
    <input
      type="search"
      name={`${pageParam}.q`}
      {value}
      {disabled}
      placeholder={hint}
      autocomplete="off"
      data-testid="search-input"
      class="h-9 w-72 max-w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
    />
  </label>
  <button
    type="submit"
    {disabled}
    class={`${buttonVariants({ variant: 'outline', size: 'md' })} disabled:opacity-60`}
    data-testid="search-submit"
  >
    Найти
  </button>
  {#if value}
    <button
      type="button"
      {disabled}
      class="h-9 px-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="search-clear"
      onclick={() => commit('')}>сбросить</button
    >
  {/if}
</form>
