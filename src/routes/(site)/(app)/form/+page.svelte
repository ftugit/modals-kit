<script lang="ts">
  // Демонстрация формы. Правило то же, что у модалок: если опция существует,
  // она меняется прямо здесь, а не в коде (панель — `DemoPanel`, этап 4).
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { asLink } from '#hooks/links/index.js'
  import { Button, Fieldset } from '#components/ui/index.js'
  import { Form, formTask, type LiveMode } from '#lib/form/svelte/index.js'
  import type { ErrorHandler, ErrorSink, FormError, InvalidFrom, ParallelPolicy, Result } from '#lib/form/index.js'
  import {
    createRegistry, defineForm, isVisible, pollUntilDone, queuedData,
    type FormDescription, type PollOutcome,
  } from '#lib/form/index.js'
  import { code6Described, code6Plain, ratingType } from '#components/form/extend.js'
  import { checks, forms, formsCustomUi } from '#components/form/forms.config.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { normalizePsp, PSP_SAMPLES } from './psp'
  import { SPEC_ALL, SPEC_FIRST, signup, signupAll } from './signup'
  import { DemoPanel, demoDefaults } from '#components/demo/index.js'
  import { demoPanelSchema } from './demo-schema.ts'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'

  let { data }: { data: { job: { done: boolean } | { missing: true } | null } } = $props()

  /* ── обработчик ошибок: один, все сценарии внутри ─────────────── */

  type Mode = 'as-is' | 'one-block' | 'drop-code' | 'to-channel'

  /* ── панель настроек — универсальная DemoPanel (этап 4) ─────────────
     Поля — данные (`./demo-schema.ts`), форму, «Применить» до оживления и
     параметры ведёт панель. Страница получает ПАРАМЕТРЫ и живёт на них:
     `sv()` читает единственное зеркало панели, `opts` — геттеры над ним
     (C3: эффект-синхронизатор не нужен). Адреса у полей нет — настройки
     демонстрации не место в ссылке, поэтому `?` страница не трогает. */
  const PANEL_DEFAULTS = demoDefaults(demoPanelSchema)
  let panel = $state<Record<string, string | boolean>>({ ...PANEL_DEFAULTS })
  const sv = (name: string) => panel[name] ?? PANEL_DEFAULTS[name]

  // Последнее принятое от панели — снимок: `onParams` приходит и эффектом
  // первого рендера, и коммитом каждого поля; реагируем на РАЗЛИЧИЕ.
  // svelte-ignore state_referenced_locally
  let lastPanel: Record<string, unknown> = untrack(() => ({ ...PANEL_DEFAULTS }))

  /**
   * Параметры панели → состояние страницы. Побочные правила демо живут здесь,
   * а не в панели: «всё в общий» переставляет источник подсветки (пишем в
   * зеркало, чтобы селектор показывал актуальное значение и уже показанные
   * ошибки перекрасились), ответ сервера уходит скрытым полем `answer` во ВСЕ
   * связки — иначе смена «первая/все» или разметки его сбросит.
   */
  function onParams(params: Record<string, unknown>): void {
    const changed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params))
      if (!Object.is(value, lastPanel[key])) changed[key] = value
    if (Object.keys(changed).length === 0) return
    if (changed.mode === 'one-block') changed.invalid_from = 'shown'
    lastPanel = { ...lastPanel, ...changed }
    panel = { ...panel, ...changed } as Record<string, string | boolean>
    if ('answer' in changed)
      for (const b of Object.values(bound)) b.f.answer?.onInput(String(changed.answer))
    if ('mode' in changed) form.redisplay()
  }


  const mode = $derived(sv('mode') as Mode)

  const handler: ErrorHandler = (errors, ctx) => {
    switch (mode) {
      case 'one-block':
        // Стереть имена полей — всё уедет в общий блок на обоих путях.
        // Раньше это работало только после native POST и выглядело сломанным
        // при включённом по умолчанию fetch-перехвате.
        return errors.map((e) => ({ ...e, path: undefined }))
      case 'drop-code':
        // ошибку просто не показываем; поле всё равно знает, что было невалидно
        return errors.filter((e) => e.code !== 'minLength')
      case 'to-channel':
        // увести во внешний канал и не возвращать: библиотека о ней не узнает.
        // Сама отправка — побочное действие, и она живёт отдельно: обработчик
        // зовут и для предпросмотра, а предпросмотр ничего слать не должен.
        return errors.filter((e) => e.path !== 'email')
      default:
        return errors
    }
  }

  /* ── настройки связывания ─────────────────────────────────────── */

  /* Настройки — геттеры над зеркалом панели, а не копия в `$state` (C3): связка
     читает их лениво, в момент использования, поэтому эффект-синхронизатор с его
     лишним тактом рассинхрона не нужен.
     https://svelte.dev/docs/svelte/$effect#When-not-to-use-$effect */
  /* Канал системных ошибок (Q1): исход «неизвестно», ошибки чужой службы,
     предупреждения. У проекта это `report` (`forms.config.ts`); здесь канал
     показан на странице. Четыре связки поднимают одно продолжение — хранится
     последнее событие, а не список. */
  let systemEvent = $state<{ code: string; outcome: string; from: string } | null>(null)
  const sink: ErrorSink = (e) => {
    const ctx = (e.ctx ?? {}) as { outcome?: string; from?: string }
    systemEvent = { code: e.code, outcome: ctx.outcome ?? '—', from: ctx.from ?? '—' }
  }
  const SYSTEM_TEXT: Record<string, string> = {
    'outcome-unknown': 'исход неизвестен: сервер не подтвердил, что всё сохранилось',
    'external-error': 'ошибка чужой службы',
    warnings: 'предупреждение после сохранения',
  }

  const opts = {
    action: '/form',
    instance: 'signup:new',
    get specVersion() { return cardinality === 'all' ? SPEC_ALL : SPEC_FIRST },
    get intercept() { return sv('intercept') === 'js' },
    get live() { return sv('live') as LiveMode },
    get parallel() { return sv('parallel') as ParallelPolicy },
    get invalidFrom() { return sv('invalid_from') as InvalidFrom },
    onErrors: handler,
    onError: sink,
    // Результат нативного POST связка берёт сама: `formResult` приходит в
    // данных страницы (`locals.formResult` → layout), эффектов для этого не нужно.
    checks,
  }

  const cardinality = $derived(sv('cardinality') as 'first' | 'all')
  const description = $derived(cardinality === 'all' ? signupAll : signup)

  /** Политика разметки адаптера: идентификаторы полей и правило перепроверки. */
  const ui = $derived(sv('markup') as 'default' | 'custom')

  // Связки создаются один раз: bind заводит реактивное состояние и подписку.
  // Настройки передаются КАК ЕСТЬ: связка читает их лениво. Копия через
  // {...opts} сделала бы каждое свойство снимком, и переключатели перестали
  // бы работать на лету.
  const bound = {
    'default:first': bindComponentForm(forms, signup, opts),
    'default:all': bindComponentForm(forms, signupAll, opts),
    'custom:first': bindComponentForm(formsCustomUi, signup, opts),
    'custom:all': bindComponentForm(formsCustomUi, signupAll, opts),
  }
  const form = $derived(bound[`${ui}:${cardinality}` as keyof typeof bound])

  /* ── песочница: расширение на лету, на СВОЁМ реестре ──────────── */

  const sandbox = $derived({
    withType: sv('with_type') === true,
    described: sv('described') === true,
  })

  /**
   * Своя сборка на собственном реестре: регистрации не протекают в основную
   * форму, хотя процесс тот же. Описание неизменяемо, поэтому при каждом
   * изменении оно собирается заново — и сразу видно, что скажет библиотека.
   */
  const built = $derived.by((): { ok: true; form: FormDescription } | { ok: false; error: string } => {
    const registry = createRegistry()
    if (sandbox.withType) registry.registerType(ratingType)
    const rule = sandbox.described ? code6Described() : code6Plain()
    try {
      return {
        ok: true,
        form: defineForm({
          id: 'sandbox',
          registry,
          fields: {
            code: { kind: 'text', input: 'text', label: 'Код', validators: [rule] },
            mark: { kind: 'rating', input: 'rating', label: 'Оценка', validators: [] },
          },
        }),
      }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) }
    }
  })

  /* ── чужая служба: сырой ответ → инструкция → обработчик ─────── */

  const sample = $derived(sv('sample') as keyof typeof PSP_SAMPLES)
  const raw = $derived(PSP_SAMPLES[sample]!)
  const normalized = $derived(normalizePsp(raw))
  const afterHandler = $derived(
    handler(normalized, { from: 'fetch', intent: 'submit', outcome: 'not-applied' }))

  // Переход из ответа сервера (`Result.redirect`) после перехвата: библиотека адрес
  // проверила и отдала, переходит приложение. Без скрипта маршрут ответил 303.
  // Один переход на отправку: возврат к связке с тем же результатом не уводит снова.
  let followed = ''
  $effect(() => {
    const r = form.state.result
    if (!r?.redirect || r.submissionId === followed) return
    followed = r.submissionId
    void goto(r.redirect)
  })
  const sent = $derived(visibleAddress().url.searchParams.get('sent') === '1')

  // Очередь: пока исход `queued`, спрашиваем сервер по `pollUrl` (пауза — от него,
  // `pollUntilDone`); итог поднимается в форму как обычный результат. Уход со
  // страницы или новая отправка обрывают опрос.
  const queued = $derived(form.state.status === 'queued' && form.state.result ? queuedData(form.state.result) : undefined)
  const poll = async (url: string, signal?: AbortSignal): Promise<PollOutcome> => {
    const r = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`опрос очереди: HTTP ${r.status}`)
    return r.json()
  }
  let pollFailed = $state(false)
  $effect(() => {
    const q = queued
    if (!q) return
    const bound = form
    const stop = new AbortController()
    pollFailed = false
    pollUntilDone(q, poll, { signal: stop.signal })
      .then((final) => { if (final) bound.lift(final); else if (!stop.signal.aborted) pollFailed = true })
      .catch(() => { if (!stop.signal.aborted) pollFailed = true })
    return () => stop.abort()
  })

  // Видимость — то же условие, что считает сервер: без скрипта поле появится
  // после отправки с отмеченным флажком.
  const companyVisible = $derived(isVisible(description.byName['company']?.visibleWhen, form.state.values))
  const checked = $derived(
    (form.state.result?.ok && (form.state.result.data as { checked?: string[] } | undefined)?.checked) || null)

  // Внешний канал: что ушло бы в него из текущих фактов — вычисление, а не
  // эффект (C3). Сама отправка — отдельно от обработчика: его зовут и для
  // предпросмотра, а предпросмотр ничего слать не должен.
  const channelLog = $derived(
    mode === 'to-channel'
      ? form.state.facts.filter((e) => e.path === 'email').map((e) => `sms: ${e.message}`)
      : [],
  )

  const attrText = (a: Record<string, unknown>) =>
    Object.entries(a)
      .filter(([k]) => !k.startsWith('aria-') && k !== 'name' && k !== 'id')
      .map(([k, val]) => (val === true ? k : `${k}="${val}"`))
      .join(' ') || '—'
</script>

<div>
  <div class="mx-auto max-w-4xl space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div class="space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">Формы</h1>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Библиотека знает два места: общие ошибки и ошибки полей. Всё остальное решает
          один обработчик — массив на входе, массив на выходе.
        </p>
      </div>
      <Button {...asLink('/modals')} variant="outline" size="sm">Модалки</Button>
    </header>

    <!-- ── настройки: панель — форма, страница — параметры ────────── -->
    <DemoPanel schema={demoPanelSchema} values={panel} onParams={onParams} />

    <!-- Итог настройки — текстом: это не контрол, панель его не носит. -->
    <section class="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm" aria-live="polite">
      <b>Сейчас демо настроено так:</b>
      ошибки
      {mode === 'one-block' ? 'собираются в общем блоке над формой' : mode === 'drop-code' ? 'показываются без minLength' : mode === 'to-channel' ? 'почты скрываются из интерфейса' : 'остаются возле своих полей'},
      на одном поле показывается {cardinality === 'all' ? 'весь список ошибок' : 'только первая ошибка'}.
      {#if form.facts.length === 0}
        <span class="block pt-1 text-foreground/70">Нажмите «Создать аккаунт» с пустыми полями. Чтобы сравнить «первая/все», введите в пароль «123» и отправьте ещё раз.</span>
      {:else}
        <span class="block pt-1">Фактов: {form.facts.length}; показано: {form.shown.length}; общих: {form.common.length}.</span>
      {/if}
    </section>
    <!-- ── форма ─────────────────────────────────────────────────── -->
    <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <Form {form} hiddenFields={form.hidden()} class="space-y-4">

        <Common errors={form.common} title="Проверьте форму" />

        {#if sent}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-sent>
            Сервер велел перейти сюда: <code>/form?sent=1</code>. <a class="underline" href="/form">Открыть форму заново</a>
          </div>
        {/if}
        {#if data.job}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-job-status>
            {#if 'missing' in data.job}
              Заявки нет: срок хранения истёк или адрес неверный.
            {:else if data.job.done}
              Заявка выполнена: запись сохранена.
            {:else}
              Заявка ещё в очереди. Обновите страницу через несколько секунд.
            {/if}
          </div>
        {/if}
        {#if queued}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-queued role="status">
            Принято. Запись будет готова примерно через {Math.round((queued.etaMs ?? 0) / 1000)} с{pollFailed ? '' : ' — спрашиваем сервер…'}
            <a class="underline" href={queued.statusUrl}>Статус заявки</a>
          </div>
        {:else if checked}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-checked>
            Почта и телефон в порядке. Остальные поля не проверялись.
          </div>
        {:else if form.state.result?.ok}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            Готово. Исход: <b>{form.state.outcome}</b>
          </div>
        {/if}

        <div class="grid gap-4 sm:grid-cols-2">
          <Field of={form.f.email} />
          <Field of={form.f.phone} />
          <Field of={form.f.password} />
          <Field of={form.f.confirm} />
          <Field of={form.f.age} />
          <Field of={form.f.tax_id} />
          <Field of={form.f.card} />
          <Field of={form.f.rating} />
          <Field of={form.f.about} />
          <Field of={form.f.invite} />
          <Field of={form.f.topics} />
        </div>
        <Field of={form.f.digest} />
        <Field of={form.f.agree} />

        <!-- ── ещё поля: остальные представления и правила ── -->
        <Fieldset legend="Ещё поля" class="space-y-4 border-t border-border pt-4" data-more-fields="">
          <div class="grid gap-4 sm:grid-cols-2">
            <Field of={form.f.site} />
            <Field of={form.f.letters} />
            <Field of={form.f.from_date} />
            <Field of={form.f.to_date} />
            <Field of={form.f.call_at} />
            <Field of={form.f.meet_at} />
            <Field of={form.f.accent} />
          </div>
          <Field of={form.f.from_company} />
          {#if companyVisible}
            <div class="grid gap-4 sm:grid-cols-2">
              <Field of={form.f.company} />
              <Field of={form.f.docs} />
            </div>
          {/if}
          <!-- скрытое: видно только в таблице «Ограничения → атрибуты» -->
          <Field of={form.f.answer} />
        </Fieldset>

        <div class="flex flex-wrap gap-2">
          <Button type="submit" {...form.intent('submit')} task={formTask(form.state, 'submit')}>
            {form.state.pendingIntent === 'submit' ? 'Отправка…' : 'Создать аккаунт'}
          </Button>
          <Button variant="outline" type="submit" {...form.intent('save-draft')}
                  task={formTask(form.state, 'save-draft')}>
            {form.state.pendingIntent === 'save-draft' ? 'Сохранение…' : 'Сохранить черновик'}
          </Button>
          <Button variant="outline" type="submit" {...form.intent('check-contacts')}
                  task={formTask(form.state, 'check-contacts')}>
            {form.state.pendingIntent === 'check-contacts' ? 'Проверка…' : 'Проверить контакты'}
          </Button>
        </div>
      </Form>
    </section>

    {#if systemEvent}
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm" data-system-channel>
        <div class="mb-2 text-sm font-semibold">Канал системных ошибок</div>
        <p class="text-sm">{SYSTEM_TEXT[systemEvent.code] ?? systemEvent.code}</p>
        <p class="mt-1 font-mono text-xs text-muted-foreground">{systemEvent.code} · исход: {systemEvent.outcome} · путь: {systemEvent.from}</p>
      </section>
    {/if}

    {#if channelLog.length}
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-2 text-sm font-semibold">Внешний канал</div>
        <pre class="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{channelLog.join('\n')}</pre>
      </section>
    {/if}

    <!-- ── песочница расширения ──────────────────────────────────── -->
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-3 text-sm font-semibold">Расширение на лету — на отдельном реестре</div>
        <p class="mb-3 text-xs text-muted-foreground">
          Переключатели — в панели настроек выше: «Тип значения rating» и «Правило
          «шестизначный код» — с описанием». Таблица ниже показывает, что из этого
          вышло.
        </p>

        {#if built.ok}
          <table class="w-full text-left text-xs">
            <thead class="text-muted-foreground">
              <tr>
                <th class="py-1 pr-3 font-medium">поле</th>
                <th class="py-1 pr-3 font-medium">выведено в разметку</th>
                <th class="py-1 font-medium">не выведено и почему</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              {#each built.form.fields as f (f.name)}
                {@const a = built.form.attrsOf(f.name)}
                <tr class="border-t border-border/60 align-top">
                  <td class="py-1 pr-3">{f.name}</td>
                  <td class="py-1 pr-3 text-muted-foreground">{attrText(a.attrs)}</td>
                  <td class="py-1 text-muted-foreground">
                    {#each a.skipped as s (s.kind)}<div><b>{s.kind}</b> — {s.why}</div>{:else}—{/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <!-- без bg-подложки: text-destructive на 5%-тонированном фоне даёт 4.36:1,
               на фоне карты контраст держится в обеих темах -->
          <pre class="rounded-lg border border-destructive/40 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">{built.error}</pre>
        {/if}

        <p class="mt-2 text-xs text-muted-foreground">
          Реестр здесь свой: основная форма выше о нём не знает и продолжает работать.
          Пока тип не зарегистрирован, описание не объявляется — и говорит, чего не хватает.
          Правило без описания работает, но атрибута не даёт: причина названа.
        </p>
      </section>

    <!-- ── чужая служба ──────────────────────────────────────────── -->
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-3 text-sm font-semibold">Чужая служба: нормализация до обработчика</div>
        <p class="mb-3 text-xs text-muted-foreground">
          Образец выбирается в панели настроек выше — «Образец чужой службы».
        </p>
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <div class="mb-1 text-xs font-medium text-muted-foreground">сырой ответ</div>
            <pre class="rounded-lg bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(raw.body, null, 1)}</pre>
          </div>
          <div>
            <div class="mb-1 text-xs font-medium text-muted-foreground">после инструкции — ФАКТ</div>
            <pre class="rounded-lg bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{normalized
              .map((e) => `${e.path ?? '*'} ${e.code}\n  ${e.message ?? '—'}`).join('\n')}</pre>
          </div>
          <div>
            <div class="mb-1 text-xs font-medium text-muted-foreground">после обработчика — ПОКАЗ</div>
            <pre class="rounded-lg bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{afterHandler
              .map((e) => `${e.path ?? '*'} ${e.code}`).join('\n') || '— пусто'}</pre>
          </div>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          Разработчик получает наши имена: <code>pan → card</code>, <code>payer.contact → email</code>.
          Не нашлось соответствия — ошибка просто общая. Исходные данные службы остаются
          в <code>source</code>, чтобы было чем манипулировать.
        </p>
      </section>

    <!-- ── отчёт: собирается обходом реестра ─────────────────────── -->
    <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div class="mb-2 text-sm font-semibold">Ограничения → атрибуты</div>
      <!-- tabindex: без него узкий экран делает регион прокручиваемым,
             но недоступным с клавиатуры (scrollable-region-focusable).
             Линтер это не знает — для него region неинтерактивен. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="overflow-x-auto" tabindex="0" role="region" aria-label="Ограничения и атрибуты">
        <table class="w-full text-left text-xs">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 pr-3 font-medium">поле</th>
              <th class="py-1 pr-3 font-medium">виды ограничений</th>
              <th class="py-1 pr-3 font-medium">выведено в разметку</th>
              <th class="py-1 font-medium">не выведено и почему</th>
            </tr>
          </thead>
          <tbody class="font-mono">
            {#each description.fields as f (f.name)}
              {@const a = description.attrsOf(f.name)}
              {@const cs = description.constraintsOf(f.name)}
              <tr class="border-t border-border/60 align-top">
                <td class="py-1 pr-3">{f.name}</td>
                <td class="py-1 pr-3 text-muted-foreground">{cs.map((c) => c.kind).join(' ') || '—'}</td>
                <td class="py-1 pr-3 text-muted-foreground">{attrText(a.attrs)}</td>
                <td class="py-1 text-muted-foreground">
                  {#each a.skipped as s (s.kind)}
                    <div><b>{s.kind}</b> — {s.why}</div>
                  {:else}—{/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        Таблица не записана в библиотеке: она строится обходом реестра. Тип
        <code>rating</code> и правила <code>inn</code>, <code>luhn</code> зарегистрированы
        приложением — в <code>src/lib/form</code> про них нет ни строки.
      </p>
    </section>

    <!-- ── факт против показа ────────────────────────────────────── -->
    <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div class="mb-2 text-sm font-semibold">Факт и показ</div>
      <!-- text-foreground/70, а не muted-foreground: на bg-muted у того 4.39:1 -->
      <div class="rounded-lg bg-muted p-2 font-mono text-xs text-foreground/70">
        статус: {form.state.status} · в полёте: {form.state.pendingIntent ?? '—'} ·
        исход: {form.state.outcome ?? '—'} ·
        фактов: {form.state.facts.length} · показано: {form.state.shown.length} ·
        убрано обработчиком: {form.state.removed}
      </div>
      {#if form.state.facts.length}
        <!-- клавиатурный доступ к прокручиваемому региону (scrollable-region-focusable);
             ignore нужен внутри блока: снаружи {#if} он не действует -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="mt-2 overflow-x-auto" tabindex="0" role="region" aria-label="Факт и показ">
          <table class="w-full text-left text-xs">
            <thead class="text-muted-foreground">
              <tr>
                <th class="py-1 pr-3 font-medium">код</th>
                <th class="py-1 pr-3 font-medium">поле (факт)</th>
                <th class="py-1 pr-3 font-medium">поле (показ)</th>
                <th class="py-1 font-medium">текст</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              {#each form.state.facts as e (e.id)}
                {@const shown = form.state.shown.find((x: FormError) => x.id === e.id)}
                <tr class="border-t border-border/60">
                  <td class="py-1 pr-3">{e.code}</td>
                  <td class="py-1 pr-3">{e.path ?? '*'}</td>
                  <td class="py-1 pr-3">{shown ? (shown.path ?? '*') : '— убрана'}</td>
                  <td class="py-1 text-muted-foreground">{shown?.message ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <p class="text-xs text-muted-foreground">
      «Повторите пароль» проверяет только сервер: вида ограничения для сравнения полей
      не существует, и браузер такое не умеет. Поэтому именно на нём видно, что без
      скрипта поведение то же.
    </p>
  </div>
</div>
