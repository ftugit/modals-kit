<script lang="ts">
  import { currentPathname, currentSearch } from '$lib/router/sveltekit'
  import { getClientStore, setExtra } from '$lib/paginate'
  import { normalizeSearchQuery } from '$lib/search'

  interface Props {
    /** Имя пагинатора (оно же имя поиска: им пользуется lib search). */
    name: string
    /** Адресный ключ запроса: `page.q` — его пишет GET-форма без JS и адаптер с JS. */
    path: string
    maxLength?: number
    debounce?: number
    /** Запрос выключен опцией панели — поле не принимает ввод. */
    disabled?: boolean
    /**
     * ПОЧЕМУ запрос выключен: «источник не поддерживает поиск», «поиск выключен
     * опциями панели». Причина — часть выключенного поля, а не только проза под
     * формой: пользователь видит её там же, где пытается вводить.
     */
    hint?: string
  }

  let {
    name,
    path,
    maxLength = 120,
    debounce = 300,
    disabled = false,
    hint,
  }: Props = $props()

  // Запись запроса — штатный `setExtra` пагинатора (строка как у исходника,
  // `ShikimoriPage.tsx`): `q` — restorable-ключ extra, он же входит в
  // `reloadKeys`, поэтому смена запроса сама сбрасывает выдачу на первую
  // страницу и уходит в адрес через транспорт пагинатора. Нормализация —
  // общая с lib search (та же, что у валидатора адреса).
  const commit = (value: string) =>
    void setExtra(getClientStore(), name, { q: normalizeSearchQuery(value, maxLength) })

  /**
   * Текущее значение: до гидратации и без JS — из адреса (SSR/deep-link — как
   * у канона: форма рождается с запросом), с JS — «своё» состояние ввода,
   * чтобы echo-persist адреса не переставлял курсор в инпуте.
   */
  const fromAddress = $derived(String(currentSearch()[path] ?? '').slice(0, maxLength))
  let typed = $state<string | null>(null)
  const value = $derived(typed ?? fromAddress)

  let timer: ReturnType<typeof setTimeout> | undefined
  const stopTimer = () => clearTimeout(timer)

  /**
   * Отправка: без JS адрес берёт GET-форма (собственный указатель страницы в неё
   * не кладётся — новый запрос начинается с первой страницы); с JS тот же ключ
   * уходит в `setSearchQuery` — запрос живёт в extra пагинатора, сброс страницы и
   * запись адреса делает его транспорт.
   */
  function submit(event: SubmitEvent) {
    stopTimer()
    event.preventDefault()
    if (disabled) return
    commit(value)
  }

  function onInput(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).value.slice(0, maxLength)
    typed = next
    stopTimer()
    if (disabled) return
    // Живой ввод идёт тем же путём, что submit, — с дебаунсом.
    timer = setTimeout(() => commit(next), debounce)
  }

  function clear() {
    stopTimer()
    typed = ''
    commit('')
  }

  /**
   * Чужие ключи адреса — скрытыми полями: без JS GET-submit их не сотрёт.
   * Свой ключ запроса и указатель страницы не сохраняются (см. выше).
   */
  const preserved = $derived(
    Object.entries(currentSearch())
      .filter(([key]) => key !== path && key !== 'page')
      .map(([key, val]) => [key, String(val)] as const)
  )
</script>

<!--
  Поле поиска — обычная GET-форма (как у панели настроек и в каноне): без JS
  submit ведёт на `action?<path>=…`, SSR-лоадер отдаёт данные источника,
  сужённые родным поиском. С JS форма перехватывается, и тем же ключом
  управляет lib search (fuzzy + коррекция) либо родной поиск источника —
  по опциям панели.
-->
<form
  method="get"
  action={currentPathname()}
  role="search"
  data-testid="search-form"
  class="mb-3 flex flex-wrap items-center gap-2"
  onsubmit={submit}
  onreset={(event) => {
    event.preventDefault()
    clear()
  }}
>
  {#each preserved as [key, val] (key + '=' + val)}
    <input type="hidden" name={key} value={val} />
  {/each}
  <input
    type="search"
    data-testid="search-input"
    name={path}
    {disabled}
    maxlength={maxLength}
    {value}
    placeholder="Тайтл: «наруто», «naruto», «нарута»"
    aria-label="Поиск по каталогу"
    title={disabled ? hint : undefined}
    class="h-9 min-w-56 flex-1 rounded-lg border border-border bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground disabled:opacity-50"
    oninput={onInput}
  />
  {#if disabled && hint}
    <!-- Причина стоит в потоке формы последней строкой: видно рядом с полем,
         которое не принимает ввод. -->
    <span class="order-last w-full text-xs text-muted-foreground" data-field-hint>{hint}</span>
  {/if}
  <button
    type="submit"
    data-testid="search-submit"
    {disabled}
    class="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-xs hover:bg-accent disabled:opacity-50"
  >
    Найти
  </button>
  <button
    type="reset"
    data-testid="search-clear"
    disabled={disabled || !value}
    class="h-9 rounded-lg border border-border bg-card px-3 text-sm shadow-xs hover:bg-accent disabled:opacity-50"
  >
    Сбросить
  </button>
</form>
