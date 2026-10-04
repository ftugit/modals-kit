<script lang="ts">
  // Демонстрация формы. Правило то же, что у модалок: если опция существует,
  // она меняется прямо здесь, а не в коде.
  import { untrack } from 'svelte'
  import { bind, type LiveMode } from '$lib/form/svelte'
  import type { ErrorHandler, FormError, InvalidFrom, ParallelPolicy, Result } from '$lib/form'
  import {
    compileFieldSpec, createRegistry, defaultRegistry, defineForm, editor,
    type FormDescription,
  } from '$lib/form'
  import { code6Described, code6Plain, ratingType } from './extend'
  import { checks, forms, formsCustomUi } from './forms.config'
  import { normalizePsp, PSP_SAMPLES } from './psp'
  import { SPEC_ALL, SPEC_FIRST, signup, signupAll } from './signup'
  import Control from './Control.svelte'
  import Segmented from './Segmented.svelte'
  import Common from './ui/Common.svelte'
  import Field from './ui/Field.svelte'

  let { form: actionResult }: { form?: { result?: Result } | null } = $props()

  /** Снимок результата действия на момент связывания — читается намеренно один раз. */
  const initialResult = untrack(() => actionResult?.result ?? null)

  /* ── обработчик ошибок: один, все сценарии внутри ─────────────── */

  type Mode = 'as-is' | 'one-block' | 'drop-code' | 'to-channel'
  let mode = $state<Mode>('as-is')
  let channelLog = $state<string[]>([])

  const handler: ErrorHandler = (errors, ctx) => {
    switch (mode) {
      case 'one-block':
        // режим PHP: стереть имена полей — всё уедет в общий блок.
        // Только для серверного пути, в браузере поведение обычное.
        return ctx.from === 'action'
          ? errors.map((e) => ({ ...e, path: undefined }))
          : errors
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

  const opts = $state({
    action: '/form',
    instance: 'signup:new',
    specVersion: SPEC_FIRST,
    intercept: true,
    live: 'after-touched' as LiveMode,
    parallel: 'block' as ParallelPolicy,
    invalidFrom: 'fact' as InvalidFrom,
    onErrors: handler,
    // результат действия передаётся ПРИ СВЯЗЫВАНИИ: без скрипта эффектов нет,
    // и ошибки обязаны оказаться уже в серверной разметке
    continuation: initialResult,
    checks,
  })

  let cardinality = $state<'first' | 'all'>('first')
  const description = $derived(cardinality === 'all' ? signupAll : signup)
  $effect(() => { opts.specVersion = cardinality === 'all' ? SPEC_ALL : SPEC_FIRST })

  /** Политика разметки адаптера: идентификаторы полей и правило перепроверки. */
  let ui = $state<'default' | 'custom'>('default')

  // Связки создаются один раз: bind заводит реактивное состояние и подписку.
  // Настройки передаются КАК ЕСТЬ: связка читает их лениво. Копия через
  // {...opts} сделала бы каждое свойство снимком, и переключатели перестали
  // бы работать на лету.
  const bound = {
    'default:first': bind(forms, signup, opts),
    'default:all': bind(forms, signupAll, opts),
    'custom:first': bind(formsCustomUi, signup, opts),
    'custom:all': bind(formsCustomUi, signupAll, opts),
  }
  const form = $derived(bound[`${ui}:${cardinality}` as keyof typeof bound])

  /* ── песочница: расширение на лету, на СВОЁМ реестре ──────────── */

  const sandbox = $state({ withType: false, described: false })

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

  let sample = $state<keyof typeof PSP_SAMPLES>('поле и код известны')
  const raw = $derived(PSP_SAMPLES[sample]!)
  const normalized = $derived(normalizePsp(raw))
  const afterHandler = $derived(
    handler(normalized, { from: 'fetch', intent: 'submit', outcome: 'not-applied' }))

  $effect(() => { form.lift(actionResult?.result) })

  // Побочное действие внешнего канала: отдельно от обработчика.
  $effect(() => {
    if (mode !== 'to-channel') return
    const taken = form.state.facts.filter((e) => e.path === 'email')
    if (taken.length) channelLog = taken.map((e) => `sms: ${e.message}`)
  })

  const attrText = (a: Record<string, unknown>) =>
    Object.entries(a)
      .filter(([k]) => !k.startsWith('aria-') && k !== 'name' && k !== 'id')
      .map(([k, val]) => (val === true ? k : `${k}="${val}"`))
      .join(' ') || '—'

  /**
   * Поле из рантайма: приложение отдаёт СПЕЦИФИКАЦИЮ, библиотека её
   * компилирует и проверяет. Функции в спецификации запрещены.
   */
  let runtimeCount = 0
  function addRuntimeField() {
    const compiled = compileFieldSpec({
      name: `extra${++runtimeCount}`,
      input: 'tel',
      label: `Телефон ${runtimeCount}`,
      help: 'Создано в рантайме: шаблон пришёл из реестра приложения',
      required: true,
      rules: [{ rule: 'pattern', arg: 'e164' }],
    }, { registry: defaultRegistry, policy: description.policy })
    if (!compiled.ok) { console.error(compiled.defects); return }
    form.apply([editor.add(compiled.field)])
  }
</script>

<div class="py-10 sm:py-14">
  <div class="mx-auto max-w-4xl space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div class="space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">Формы</h1>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Библиотека знает два места: общие ошибки и ошибки полей. Всё остальное решает
          один обработчик — массив на входе, массив на выходе.
        </p>
      </div>
      <a href="/modals"
         class="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
        Модалки
      </a>
    </header>

    <!-- ── настройки ─────────────────────────────────────────────── -->
    <section class="grid gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:grid-cols-2">
      <Control label="Обработчик ошибок">
        <Segmented
          value={mode}
          onChange={(x) => (mode = x as Mode)}
          options={[
            { value: 'as-is', label: 'как есть' },
            { value: 'one-block', label: 'всё в общий', hint: 'только при пути action: стираем path' },
            { value: 'drop-code', label: 'без minLength', hint: 'текста нет, поле всё равно подсвечено' },
            { value: 'to-channel', label: 'почту — в канал', hint: 'ушла в sms и не вернулась' },
          ]}
        />
      </Control>

      <Control label="Откуда берётся подсветка">
        <Segmented
          value={opts.invalidFrom}
          onChange={(x) => (opts.invalidFrom = x as InvalidFrom)}
          options={[
            { value: 'fact', label: 'по факту', hint: 'ошибка была — поле подсвечено' },
            { value: 'shown', label: 'по показу', hint: 'забрали текст — погасло' },
          ]}
        />
      </Control>

      <Control label="Перехват отправки">
        <Segmented
          value={opts.intercept ? 'js' : 'native'}
          onChange={(x) => (opts.intercept = x === 'js')}
          options={[
            { value: 'js', label: 'перехватывать', hint: 'тот же FormData через fetch' },
            { value: 'native', label: 'нативно', hint: 'обычный POST, действие SvelteKit' },
          ]}
        />
      </Control>

      <Control label="Режим живой проверки">
        <Segmented
          value={opts.live}
          onChange={(x) => (opts.live = x as LiveMode)}
          options={[
            { value: 'after-touched', label: 'после касания' },
            { value: 'on-blur', label: 'при уходе' },
            { value: 'on-input', label: 'при вводе' },
            { value: 'on-submit', label: 'при отправке' },
          ]}
        />
      </Control>

      <Control label="Сколько ошибок на поле">
        <Segmented
          value={cardinality}
          onChange={(x) => (cardinality = x as 'first' | 'all')}
          options={[
            { value: 'first', label: 'первая' },
            { value: 'all', label: 'все', hint: 'свойство описания: состояние начнётся заново' },
          ]}
        />
      </Control>

      <Control label="Политика разметки адаптера">
        <Segmented
          value={ui}
          onChange={(x) => (ui = x as 'default' | 'custom')}
          options={[
            { value: 'default', label: 'умолчания', hint: 'id вида signup-email' },
            { value: 'custom', label: 'свои', hint: 'id вида fld_signup__email и проверка на вводе' },
          ]}
        />
      </Control>

      <Control label="Параллельные отправки">
        <Segmented
          value={opts.parallel}
          onChange={(x) => (opts.parallel = x as ParallelPolicy)}
          options={[
            { value: 'block', label: 'блокировать' },
            { value: 'replace', label: 'заменять' },
            { value: 'queue', label: 'очередь' },
          ]}
        />
      </Control>
    </section>

    <!-- ── форма ─────────────────────────────────────────────────── -->
    <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <form {...form.formProps()} class="space-y-4">
        {#each form.hidden() as h (h.name)}<input {...h} />{/each}

        <Common errors={form.common} title="Проверьте форму" />

        {#if form.state.result?.ok}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            Готово. Исход: <b>{form.state.outcome}</b>
          </div>
        {/if}

        <div class="grid gap-4 sm:grid-cols-2">
          <Field of={form.f.email} />
          <Field of={form.f.age} />
          <Field of={form.f.password} />
          <Field of={form.f.confirm} />
          <Field of={form.f.tax_id} />
          <Field of={form.f.card} />
          <Field of={form.f.rating} />
          <Field of={form.f.about} />
        </div>
        <Field of={form.f.agree} />

        <!-- повторяемая группа: ключи стабильны, индекс — производное -->
        <fieldset class="space-y-3 rounded-lg border border-border p-3">
          <legend class="px-1 text-xs font-medium text-muted-foreground">Позиции</legend>
          {#each form.rows('items').keys as key (key)}
            <div data-row={key} class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              {#each form.rows('items').row(key) as f (f.name)}<Field of={f} />{/each}
              <button type="button" class="self-end rounded-md border border-border px-3 py-2 text-xs"
                      onclick={() => form.apply([editor.removeRow('items', key)])}>
                Удалить
              </button>
            </div>
          {/each}
          <button type="button"
                  class="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                  onclick={() => form.apply([editor.addRow('items', `r${Date.now() % 100000}`)])}>
            + Позиция
          </button>
        </fieldset>

        <!-- поле, созданное в рантайме: та же операция, те же атрибуты -->
        {#if form.custom().length}
          <div class="grid gap-4 sm:grid-cols-2">
            {#each form.custom() as f (f.name)}<Field of={f} />{/each}
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button type="button"
                  class="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                  onclick={addRuntimeField}>
            + Поле из рантайма
          </button>
          <button {...form.intent('submit')}
                  class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50">
            {form.state.pendingIntent === 'submit' ? 'Отправка…' : 'Создать аккаунт'}
          </button>
          <button {...form.intent('save-draft')}
                  class="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
            {form.state.pendingIntent === 'save-draft' ? 'Сохранение…' : 'Сохранить черновик'}
          </button>
        </div>
      </form>
    </section>

    {#if channelLog.length}
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-2 text-sm font-semibold">Внешний канал</div>
        <pre class="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{channelLog.join('\n')}</pre>
      </section>
    {/if}

    <!-- ── песочница расширения ──────────────────────────────────── -->
    <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div class="mb-3 text-sm font-semibold">Расширение на лету — на отдельном реестре</div>
      <div class="mb-3 grid gap-4 sm:grid-cols-2">
        <Control label="Тип значения rating">
          <Segmented
            value={sandbox.withType ? 'on' : 'off'}
            onChange={(x) => (sandbox.withType = x === 'on')}
            options={[
              { value: 'off', label: 'не зарегистрирован' },
              { value: 'on', label: 'зарегистрирован' },
            ]}
          />
        </Control>
        <Control label="Правило «шестизначный код»">
          <Segmented
            value={sandbox.described ? 'on' : 'off'}
            onChange={(x) => (sandbox.described = x === 'on')}
            options={[
              { value: 'off', label: 'без описания' },
              { value: 'on', label: 'с описанием' },
            ]}
          />
        </Control>
      </div>

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
        <pre class="rounded-lg border border-destructive/40 bg-destructive/5 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">{built.error}</pre>
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
      <div class="mb-3">
        <Segmented
          value={sample}
          onChange={(x) => (sample = x as keyof typeof PSP_SAMPLES)}
          options={Object.keys(PSP_SAMPLES).map((k) => ({ value: k, label: k }))}
        />
      </div>
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
      <div class="overflow-x-auto">
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
      <div class="rounded-lg bg-muted p-2 font-mono text-xs text-muted-foreground">
        статус: {form.state.status} · в полёте: {form.state.pendingIntent ?? '—'} ·
        исход: {form.state.outcome ?? '—'} ·
        фактов: {form.state.facts.length} · показано: {form.state.shown.length} ·
        убрано обработчиком: {form.state.removed}
      </div>
      {#if form.state.facts.length}
        <div class="mt-2 overflow-x-auto">
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
