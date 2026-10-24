<script lang="ts">
  // Демо хода шагов (lib/components/steps) — в каноне демо-страниц (шапка +
  // панель настроек + одна активная область, как у пагинатора). Режим демо
  // живёт в адресе (`?demo=url|local|hybrid|form` — свой ключ брони), панель —
  // универсальная DemoPanel: без скрипта — нативный GET, с JS — мелкая запись
  // адреса (не полная навигация). Схема полей — в demo-schema.ts.
  import { page } from '$app/state'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { untrack } from 'svelte'
  import { Steps, FormSteps, formSteps, stepLink, useSteps } from '#components/steps/index.js'
  import { asLink } from '#hooks/links/index.js'
  import { bind } from '#lib/form/svelte/index.js'
  import FieldInput from '#components/form/Field.svelte'
  import Form from '#lib/form/svelte/Form.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button } from '#components/ui/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { kitActionTransport } from '#hooks/component-form/transport.js'
  import { FSTEP_STEPS, fstepForm } from './fstep-form.ts'
  import { demoPanelSchema, type DemoMode } from './demo-schema.ts'
  import { DemoPanel, demoParams } from '#components/demo/index.js'
  import StepsDemoFields from './StepsDemoFields.svelte'
  import type { Result } from '#lib/form/index.js'

  let { form: action }: { form?: { result?: Result } | null } = $props()

  /* ── режим и опции демо: схему и адрес ведёт DemoPanel (demo-schema.ts),
     страница читает ПАРАМЕТРЫ и выбирает по ним активный хост шагов ── */
  const initialDemo = demoParams(demoPanelSchema, visibleAddress().url)
  let demo = $state(initialDemo)
  const mode = $derived(demo.demo as DemoMode)
  const withNav = $derived(demo.nav)
  const withFilled = $derived(demo.filled)

  const TEXT: Record<string, string> = {
    compose: 'Шаг «Состав»: произвольное содержимое — хост не знает про форму.',
    confirm: 'Шаг «Подтверждение»: контент переключает сам потребитель (сниппеты компонента).',
    done: 'Шаг «Готово»: адресные шаги глубоко ссылаемы, локальные — нет.',
  }

  /* ── адресные режимы: один хост на активный режим (пересоздание — {#key}) ── */
  const DEFS = () => [
    { key: 'compose', label: 'Состав', filled: withFilled },
    { key: 'confirm', label: 'Подтверждение', filled: withFilled },
    { key: 'done', label: 'Готово', filled: withFilled },
  ]
  const urlSteps = useSteps({
    owner: 'steps-demo-url',
    mode: 'url',
    key: 'ustep',
    steps: DEFS,
    current: () => (visibleAddress().url.searchParams.get('ustep') ?? 'compose'),
  })
  const localSteps = useSteps({
    owner: 'steps-demo-local',
    mode: 'local',
    key: 'lstep',
    steps: DEFS,
    current: () => 'compose',
  })
  const hybridSteps = useSteps({
    owner: 'steps-demo-hybrid',
    mode: 'hybrid',
    key: 'hstep',
    steps: DEFS,
    current: () => (visibleAddress().url.searchParams.get('hstep') ?? 'compose'),
  })

  /* ── смешанный хост: обычные шаги + куст той же формы на шаге `form` ──────
     Один хост hybrid (`?mstep`): `about`/`finish` — обычные шаги-тексты,
     `form` — куст formSteps (та же форма, свой экземпляр привязки): срез —
     второй сегмент полного ключа (`form.extra`), адрес пишет только хост.
     Вторая привязка — свой instance: результат-продолжение поднимет только
     та форма, что отправлялась. */
  const mixedSteps = useSteps({
    owner: 'steps-demo-mixed',
    mode: 'hybrid',
    key: 'mstep',
    steps: () => [
      { key: 'about', label: 'О чём речь', filled: withFilled },
      { key: 'form', label: 'Анкета', filled: withFilled },
      { key: 'finish', label: 'Финиш', filled: withFilled },
    ],
    current: () => visibleAddress().url.searchParams.get('mstep') ?? 'about',
  })
  const boundMixed = bind(forms, fstepForm, {
    action: '/steps?demo=mixed&mstep=form', // нативный POST приземляется на шаг куста
    instance: 'fstep:mixed',
    transport: kitActionTransport('/steps'),
    continuation: untrack(() => action?.result ?? null),
  })
  const fsMixed = formSteps(boundMixed, { steps: FSTEP_STEPS, at: 'form', host: mixedSteps })

  /* ── режим form: срезы ОДНОЙ формы (formSteps, хост не нужен) ─────────────
     Смена среза — submit (интенция экшена), валидаторы среза — subset экшена,
     свёрнутый шаг скрыт details-ом, но его поля едут в каждом POST. Шаг ведёт
     сам formSteps по результату привязки: отправленный — по Result.intent,
     следующий при успехе называет сервер в Result.data.step; no-JS стартует
     с результата-продолжения (continuation ниже). Страница ничего не качает. */
  const bound = bind(forms, fstepForm, {
    action: '/steps?demo=form',
    transport: kitActionTransport('/steps'),
    continuation: untrack(() => action?.result ?? null),
  })
  const fs = formSteps(bound, { steps: FSTEP_STEPS })

  // Видимый адрес: показывает и мелкие записи панели (адрес отрисовки отстаёт).
  const address = $derived(visibleAddress().url.pathname + visibleAddress().url.search)
  /* активный хост адресных режимов; пересоздание не нужно — у каждого свой
     ключ брони, состояние локальных переживёт переключение панели */
  const addressSteps = $derived(mode === 'url' ? urlSteps : mode === 'local' ? localSteps : hybridSteps)
</script>

<svelte:head>
  <title>Шаги — modals-kit</title>
  <meta
    name="description"
    content="Ход шагов: адресные режимы (url/local/hybrid), форм-режим (шаги управляют валидаторами через subset экшенов, свёрнутый шаг едет в каждом POST) и смешанный хост — куст формы среди обычных шагов, адрес цепочкой."
  />
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-6">
  <header class="space-y-3">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-3xl font-semibold tracking-tight">Шаги</h1>
      <a
        {...asLink('/')}
        class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >← на главную</a>
    </div>
    <p class="text-muted-foreground">
      Один хост (<code class="rounded bg-muted/70 px-1">useSteps</code>), пять режимов.
      Адресные меняют адрес своим ключом брони (<code class="rounded bg-muted/70 px-1">?ustep</code>,
      <code class="rounded bg-muted/70 px-1">?hstep</code>), локальный — модальный сценарий без адреса.
      Форм-режим — шаги поверх одной формы: переход — submit с интенцией, валидаторы шага —
      <code class="rounded bg-muted/70 px-1">subset</code> экшена, свёрнутый шаг скрыт, но его поля
      едут в каждом POST. Смешанный — один хост: обычные шаги и куст той же формы на шаге
      «Анкета», адрес — цепочка <code class="rounded bg-muted/70 px-1">?mstep=form.extra</code>.
    </p>
  </header>

  <!-- панель демо — универсальный DemoPanel: схема в demo-schema.ts, адрес,
       seed и «Применить» ведёт он сам; странице остаются параметры -->
  <DemoPanel
    schema={demoPanelSchema}
    ui={StepsDemoFields}
    onParams={(p) => (demo = p as typeof initialDemo)}
  >
    {#snippet footer()}
      <p>
        {#if mode === 'form'}
          Сценарии разбора: имя <code class="rounded bg-muted/70 px-1">ошибка</code> или любая
          электропочта кроме <code class="rounded bg-muted/70 px-1">test@test.local</code> при
          финальном «Сохранить» — правила живут только на сервере и указывают на поля ПЕРВОГО
          (к тому времени скрытого) шага: разбор раскроет его и покажет поле.
        {:else if mode === 'local'}
          Локальный режим: смена шагов — состояние хоста, адрес не пишется (сценарий модалок).
        {:else if mode === 'hybrid'}
          Гибрид: смена локально, адрес синхронизируется своим ключом брони (?hstep).
        {:else if mode === 'mixed'}
          Смешанный хост: обычные шаги («О чём речь», «Финиш») и куст формы на шаге
          «Анкета». Адрес — цепочка <code class="rounded bg-muted/70 px-1">?mstep=form.extra</code>:
          первый сегмент — шаг хоста, второй — срез формы; deep-link прямо на срез работает.
        {:else}
          Адресный режим: ссылки меняют ?ustep, deep-link и обновление работают сами.
        {/if}
      </p>
    {/snippet}
  </DemoPanel>

  {#if mode === 'url' || mode === 'local' || mode === 'hybrid'}
    <div class="space-y-4" data-testid="demo-steps">
      {#if withNav}
        <Steps host={addressSteps} label="Шаги демо" />
      {/if}
      <Steps host={addressSteps} label="" nav={false}>
        {#snippet compose()}<p class="rounded-md border p-3 text-sm">{TEXT.compose}</p>{/snippet}
        {#snippet confirm()}<p class="rounded-md border p-3 text-sm">{TEXT.confirm}</p>{/snippet}
        {#snippet done()}<p class="rounded-md border p-3 text-sm">{TEXT.done}</p>{/snippet}
      </Steps>
      <p class="font-mono text-xs text-muted-foreground">адрес: {address}</p>
    </div>
  {:else if mode === 'mixed'}
    <div class="space-y-4" data-testid="demo-mixed">
      <Steps host={mixedSteps} label="Смешанный хост" nav={withNav}>
        {#snippet about()}
          <div class="space-y-3 rounded-md border p-3 text-sm">
            <p>Обычный шаг хоста — просто текст. На шаге «Анкета» живёт куст той же формы
              (срезы «Контакты» и «Примечание»): полный ключ — цепочка
              <code class="rounded bg-muted/70 px-1">form.extra</code>, адрес пишет один хост.</p>
            <p><a {...stepLink(mixedSteps, 'form')} class="font-medium underline underline-offset-4">К анкете →</a></p>
          </div>
        {/snippet}
        {#snippet form()}
          <Form id="fstep-mixed" form={boundMixed} hiddenFields={boundMixed.hidden()}>
            {#if boundMixed.state.result?.ok && (boundMixed.state.result.data as { saved?: boolean } | undefined)?.saved}
              <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                Готово. Исход: <b>{boundMixed.state.outcome}</b> ·
                <a {...stepLink(mixedSteps, 'finish')} class="font-medium underline underline-offset-4">шаг «Финиш» →</a>
                <span class="text-muted-foreground">(переход вне куста — дело страницы, не formSteps)</span>
              </div>
            {/if}
            <Common errors={boundMixed.common} title="Форма не сохранена" />
            <FormSteps fs={fsMixed}>
              {#snippet contacts()}
                <div class="space-y-3">
                  <FieldInput of={boundMixed.f.name} />
                  <FieldInput of={boundMixed.f.email} />
                </div>
              {/snippet}
              {#snippet extra()}
                <div class="space-y-3">
                  <FieldInput of={boundMixed.f.note} />
                </div>
              {/snippet}
            </FormSteps>
            <Button type="submit" class="mt-4" {...fsMixed.submit()}>{fsMixed.isLast ? 'Сохранить' : 'Далее'}</Button>
          </Form>
        {/snippet}
        {#snippet finish()}
          <div class="space-y-3 rounded-md border p-3 text-sm">
            <p>Финиш — обычный шаг хоста вне куста формы. Сюда ведёт ссылка страницы из
              баннера успеха: formSteps переключает только свои срезы.</p>
            <p><a {...stepLink(mixedSteps, 'about')} class="font-medium underline underline-offset-4">← сначала</a></p>
          </div>
        {/snippet}
      </Steps>
      <p class="font-mono text-xs text-muted-foreground">адрес: {address}</p>
      <p class="text-xs text-muted-foreground">
        Куст подключён парой <code class="rounded bg-muted/70 px-1">at: 'form'</code> + хост:
        срез читается из остатка полного ключа, переходы «Далее» хост пишет полным ключом
        (<code class="rounded bg-muted/70 px-1">?mstep=form.extra</code>).
      </p>
    </div>
  {:else}
    <div class="space-y-4" data-testid="demo-form">
      <Form id="fstep" form={bound} hiddenFields={bound.hidden()}>
        <!-- успех — канон раздела «Формы»: форма не пропадает, баннер над полями -->
        {#if bound.state.result?.ok && (bound.state.result.data as { saved?: boolean } | undefined)?.saved}
          <div class="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            Готово. Исход: <b>{bound.state.outcome}</b>
          </div>
        {/if}
        <!-- общие ошибки видны всегда: в разборе без полевых ошибок шаги
             свёрнуты, и блок остаётся единственным сигналом -->
        <Common errors={bound.common} title="Форма не сохранена" />
        <FormSteps fs={fs}>
          {#snippet contacts()}
            <div class="space-y-3">
              <FieldInput of={bound.f.name} />
              <FieldInput of={bound.f.email} />
            </div>
          {/snippet}
          {#snippet extra()}
            <div class="space-y-3">
              <FieldInput of={bound.f.note} />
            </div>
          {/snippet}
        </FormSteps>
        <!-- единственная кнопка ПОД всеми шагами: «Далее», на финальном — «Сохранить»
             (отправка формы на сервер с полной проверкой) -->
        <Button type="submit" class="mt-4" {...fs.submit()}>{fs.isLast ? 'Сохранить' : 'Далее'}</Button>
      </Form>
      <p class="text-xs text-muted-foreground">
        Кнопка одна — под шагами: «Далее» проверяет только поля первого шага
        (<code class="rounded bg-muted/70 px-1">subset</code>) и переводит дальше; на финальном она же
        становится «Сохранить» и отправляет всю форму. Провал с чужими ошибками раскрывает шаги
        с ошибками и сворачивает чистые в «Отобразить шаг N»; почините всё — разбор отпустит.
      </p>
    </div>
  {/if}

  <p class="text-xs text-muted-foreground">
    Бронь ключей глобальна: <code class="rounded bg-muted/70 px-1">step</code> — /fields,
    <code class="rounded bg-muted/70 px-1">stage</code> — авторизация,
    <code class="rounded bg-muted/70 px-1">ustep</code>/<code class="rounded bg-muted/70 px-1">lstep</code>/<code class="rounded bg-muted/70 px-1">hstep</code>/<code class="rounded bg-muted/70 px-1">mstep</code> — это демо,
    <code class="rounded bg-muted/70 px-1">demo</code> — режим панели.
  </p>
</div>
