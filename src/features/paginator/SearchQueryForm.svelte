<script lang="ts">
  // Поле запроса — обычное поле lib/form (предписание из `lib/search/svelte`:
  // «поле запроса — обычное поле lib form, транспорт — GET-форма, а commit —
  // setSearchQuery»). S5 (§6.4): форма объявлена (`field.search`), транспорт —
  // url-канал `bind`: до гидратации нативный GET (жив и без JS), после —
  // коммит в стор пагинатора тем же `setExtra` (sink), а адрес правит транспорт
  // хранилища. Ключ объявления — адресный (`page.q`), в стор он ложится как `q`.
  import { onMount } from 'svelte'
  import { defineForm, field, v } from '$lib/form'
  import { Input } from '$lib/ui/primitives'
  import { bind, createConfig, Form } from '$lib/form/svelte'
  import { currentSearch } from '$lib/router/sveltekit'
  import { getClientStore, setExtra } from '$lib/paginate'
  import { normalizeSearchQuery } from '$lib/search'

  interface Props {
    /** Имя пагинатора (оно же имя поиска: им пользуется lib search). */
    name: string
    /** Адресный ключ запроса: `page.q` — его пишет GET-форма без JS и адаптер с JS. */
    path: string
    maxLength?: number
    debounce?: number
    /** Текущий запрос из СОСТОЯНИЯ пагинатора (не из адреса): выдача строится
     * по нему — поле обязано показывать то же. До гидратации не используется. */
    query?: string
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
    query,
    maxLength = 120,
    debounce = 300,
    disabled = false,
    hint,
  }: Props = $props()

  // Настройка одна на фичу: компоненты полей пишет хост (разметка ниже),
  // транспорт url-режиму не нужен — POST-путь не задействуется.
  const searchForms = createConfig({ resolve: () => undefined, live: 'on-input' })

  // Объявление формы — не реактивное: имя пагинатора, ключ и предел фиксируются
  // на монтаже (хост не переключает их на лету), потому и снимки props осознанные.
  // svelte-ignore state_referenced_locally
  const desc = defineForm({
    id: `search-${name}`,
    fields: {
      // svelte-ignore state_referenced_locally
      [path]: field.search({
        label: 'Поиск по каталогу',
        placeholder: 'Тайтл: «наруто», «naruto», «нарута»',
        // svelte-ignore state_referenced_locally
        validate: [v.maxLength(maxLength)],
      }),
    },
  })

  const form = bind(searchForms, desc, {
    url: {
      //Sink хоста: тот же `setExtra`, что был у самописной формы. Нормализация —
      // общая с lib search (та же, что у валидатора адреса).
      commit: (patch) =>
        void setExtra(getClientStore(), name, {
          q: normalizeSearchQuery(String(patch[path] ?? ''), maxLength),
        }),
      // Зеркало bind получает значение из состояния (не из адреса) — как хост.
      seed: () => ({ [path]: query ?? '' }),
    },
  })
  const vf = $derived(form.field(path)!)

  // Гашение поля — работа JS (тот же канон, что у панели настроек): без
  // JavaScript контрол остаётся живым, иначе браузер не отправит его значение и
  // запрос пользователя пропал бы молча. Причина видна в обоих случаях.
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /**
   * Текущее значение: до гидратации и без JS — из адреса (SSR/deep-link — как
   * у канона: форма рождается с запросом). С JS — из СТОРА пагинатора, а не из
   * адреса: хранилище может быть не адресным (`local`/`none`), и тогда поле
   * обязано показывать то же состояние, по которому строится выдача. Своё
   * состояние ввода (`typed`) поверх — чтобы эхо коммита не переставлял курсор
   * в инпуте.
   */
  const fromAddress = $derived(String(currentSearch()[path] ?? '').slice(0, maxLength))
  let typed = $state<string | null>(null)
  const value = $derived(typed ?? (hydrated ? String(query ?? '') : fromAddress))

  let timer: ReturnType<typeof setTimeout> | undefined
  const stopTimer = () => clearTimeout(timer)

  function onInput(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value.slice(0, maxLength)
    typed = raw
    // Зеркало bind и живая проверка — штатным путём поля; в sink — дебаунс.
    vf.onInput(raw)
    stopTimer()
    if (disabled) return
    // Живой ввод идёт тем же путём, что submit, — с дебаунсом (коммит читает DOM).
    timer = setTimeout(() => form.commit(), debounce)
  }

  function clear() {
    stopTimer()
    typed = ''
    vf.onInput('')
    void setExtra(getClientStore(), name, { q: '' })
  }

  /**
   * Отправка: без JS адрес берёт GET-форма (собственный указатель страницы в неё
   * не кладётся — новый запрос начинается с первой страницы); с JS тот же ключ
   * уходит в стор пагинатора — запрос живёт в extra, сброс страницы и запись
   * адреса делает его транспорт. `disabled` гасит только JS-путь (см. выше).
   */
  /**
   * Чужие ключи адреса — скрытыми полями: без JS GET-submit их не сотрёт.
   * Свой ключ запроса и указатель страницы не сохраняются (см. выше).
   */
  const preserved = $derived(
    Object.entries(currentSearch())
      .filter(([key]) => key !== path && key !== 'page')
      .map(([key, val]) => [key, String(val)] as const),
  )
</script>

<!--
  Поле поиска — GET-форма на механизме lib/form (как у панели настроек и в
  каноне): без JS submit ведёт на `action?<path>=…`, SSR-лоадер отдаёт данные
  источника, сужённые родным поиском. С JS тем же ключом управляет lib search
  (fuzzy + коррекция) либо родной поиск источника — по опциям панели.
-->
<Form
  {form}
  hiddenFields={preserved.map(([name, value]) => ({ name, value }))}
  role="search"
  data-testid="search-form"
  class="mb-3 flex flex-wrap items-center gap-2"
  onsubmit={(event) => {
    if (!hydrated) return // нативный GET до оживления (и без JS)
    event.preventDefault()
    stopTimer()
    if (!disabled) form.commit()
  }}
  onreset={(event) => {
    event.preventDefault()
    clear()
  }}
>
  <Input
    {...vf.attrs}
    type="search"
    data-testid="search-input"
    disabled={hydrated && disabled}
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
    class="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-xs hover:bg-accent disabled:opacity-50"
  >
    Сбросить
  </button>
</Form>
