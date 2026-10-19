<script lang="ts">
  // Демо хода шагов (lib/components/steps) — в каноне демо-страниц (шапка +
  // панель настроек + одна активная область, как у пагинатора). Режим демо
  // живёт в адресе (`?demo=url|local|hybrid|form` — свой ключ брони), панель —
  // нативная GET-форма: смена режима и опций работает без скрипта. С JS — то
  // же применение живьём (goto replace).
  import { page } from '$app/state'
  import { untrack } from 'svelte'
  import { Steps, FormSteps, formSteps, useSteps } from '#lib/components/steps/index.js'
  import { Field } from '#lib/components/settings/index.js'
  import { asLink } from '#lib/components/links/index.js'
  import { bind } from '#lib/form/svelte/index.js'
  import FieldInput from '#lib/components/form/Field.svelte'
  import Form from '#lib/form/svelte/Form.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import { FSTEP_STEPS, fstepForm, type FstepStep } from './fstep-form.ts'
  import type { Result } from '#lib/form/index.js'

  let { form: action }: { form?: { result?: Result; step?: FstepStep } | null } = $props()

  /* ── режим и опции демо: истина в адресе (?demo=…), как у пагинатора ── */
  const MODES = [
    ['url', 'Адрес (?ustep) — ссылки, deep-link'],
    ['local', 'Локально — состояние хоста, адрес не пишется'],
    ['hybrid', 'Адрес + локально (?hstep) — смена без навигации'],
    ['form', 'Форма — шаги управляют валидаторами (subset)'],
  ] as const
  const mode = $derived(
    (MODES.some(([v]) => v === page.url.searchParams.get('demo'))
      ? page.url.searchParams.get('demo')
      : 'url') as (typeof MODES)[number][0],
  )
  const withNav = $derived(page.url.searchParams.get('nav') !== '0')
  const withFilled = $derived(page.url.searchParams.get('filled') !== '0')

  /** Адрес с новым режимом/опциями. Панель — ссылки (no-JS работает нативно);
   * чужие ключи (ustep/hstep) не сохраняем — смена режима = чистый сценарий. */
  function demoHref(demo: string, nav: boolean, filled: boolean): string {
    const q = new URLSearchParams()
    if (demo !== 'url') q.set('demo', demo)
    if (!nav) q.set('nav', '0')
    if (!filled) q.set('filled', '0')
    const qs = q.toString()
    return `/steps${qs ? `?${qs}` : ''}`
  }

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
    current: () => (page.url.searchParams.get('ustep') ?? 'compose'),
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
    current: () => (page.url.searchParams.get('hstep') ?? 'compose'),
  })

  /* ── режим form: шаги поверх ОДНОЙ формы ──────────────────────────────────
     Смена шага — submit (интенция экшена), валидаторы шага — subset экшена,
     свёрнутый шаг скрыт details-ом, но его поля едут в каждом POST. Ответ
     экшена несёт шаг: success — следующий (Result.data.step с JS, обёртка
     экшена без JS), провал — свой. Ключ хоста — `fstep`: бронь глобальна
     (`step` занят /fields — конфликт = 500, здесь он и вылез однажды). */
  const stepOfResult = (r?: Result): FstepStep | null => {
    const d = r?.data as { step?: FstepStep } | undefined
    return d && typeof d.step === 'string' ? d.step : null
  }
  // начальное значение — ТОЛЬКО первый рендер (SSR no-JS ответ); дальше шагом
  // ведёт эффект ниже и local-хост, поэтому чтение пропа здесь — намеренное
  // svelte-ignore state_referenced_locally
  let fstep = $state<FstepStep>(action?.step ?? 'contacts')
  $effect(() => {
    const r = bound.state.result
    fstep = action?.step ?? stepOfResult(r) ?? fstep
  })
  const formStepsHost = useSteps({
    owner: 'steps-demo-form',
    mode: 'local',
    key: 'fstep',
    steps: () => FSTEP_STEPS.map((s) => ({ ...s, filled: true })),
    current: () => fstep,
  })
  // однонаправленная память шага: local-хост берёт начальное значение из
  // `current()` и дальше ведёт состояние сам (set), странице остаётся ответ
  const bound = bind(forms, fstepForm, {
    action: '/steps?demo=form',
    transport: kitActionTransport('/steps'),
    continuation: untrack(() => action?.result ?? null),
  })
  const fs = formSteps(bound, formStepsHost)

  const address = $derived(page.url.pathname + page.url.search)
  /* активный хост адресных режимов; пересоздание не нужно — у каждого свой
     ключ брони, состояние локальных переживёт переключение панели */
  const addressSteps = $derived(mode === 'url' ? urlSteps : mode === 'local' ? localSteps : hybridSteps)
</script>

<svelte:head>
  <title>Шаги — modals-kit</title>
  <meta
    name="description"
    content="Ход шагов: адресные режимы (url/local/hybrid) и форм-режим — шаги управляют валидаторами через subset экшенов, свёрнутый шаг едет в каждом POST."
  />
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-6 py-8">
  <header class="space-y-3">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-3xl font-semibold tracking-tight">Шаги</h1>
      <a
        {...asLink('/')}
        class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >← на главную</a>
    </div>
    <p class="text-muted-foreground">
      Один хост (<code class="rounded bg-muted/70 px-1">useSteps</code>), четыре режима.
      Адресные меняют адрес своим ключом брони (<code class="rounded bg-muted/70 px-1">?ustep</code>,
      <code class="rounded bg-muted/70 px-1">?hstep</code>), локальный — модальный сценарий без адреса.
      Форм-режим — шаги поверх одной формы: переход — submit с интенцией, валидаторы шага —
      <code class="rounded bg-muted/70 px-1">subset</code> экшена, свёрнутый шаг скрыт, но его поля
      едут в каждом POST.
    </p>
  </header>

  <!-- панель демо: режимы и опции — ссылки (режим и опции живут в адресе),
       no-JS работает нативно. Канон — панель пагинатора. -->
  <div
    data-testid="demo-panel"
    class="space-y-3 rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
  >
    <Field label="Режим демо" hint="Ключ режима — ?demo (своя бронь; ?ustep/?hstep — ключи шагов)">
      <div class="flex flex-wrap gap-2 pt-1">
        {#each MODES as [value, label] (value)}
          <Button
            {...asLink(demoHref(value, withNav, withFilled))}
            size="sm"
            variant={mode === value ? 'default' : 'outline'}
            aria-pressed={mode === value}
          >{label}</Button>
        {/each}
      </div>
    </Field>
    {#if mode !== 'form'}
      <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <a
          class="underline underline-offset-4 hover:text-foreground"
          href={demoHref(mode, !withNav, withFilled)}
        >Навигация сверху: {withNav ? 'скрыть' : 'показать'}</a>
        <a
          class="underline underline-offset-4 hover:text-foreground"
          href={demoHref(mode, withNav, !withFilled)}
        >Пройденные — ссылками: {withFilled ? 'выкл' : 'вкл'}</a>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">
        Сценарии разбора: имя <code class="rounded bg-muted/70 px-1">ошибка</code> или любая
        электропочта кроме <code class="rounded bg-muted/70 px-1">ada@example.com</code> при
        финальном «Сохранить» — правила живут только на сервере и указывают на поля ПЕРВОГО
        (к тому времени скрытого) шага: разбор раскроет его и покажет поле.
      </p>
    {/if}
  </div>

  {#if mode !== 'form'}
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
  {:else}
    <div class="space-y-4" data-testid="demo-form">
      <Form id="fstep" form={bound} hiddenFields={bound.hidden()}>
        <!-- общие ошибки видны всегда: в разборе без полевых ошибок шаги
             свёрнуты, и блок остаётся единственным сигналом -->
        <Common errors={bound.common} title="Форма не сохранена" />
        <FormSteps host={formStepsHost} fs={fs}>
          {#snippet contacts()}
            <div class="space-y-3">
              <FieldInput of={bound.f.name} />
              <FieldInput of={bound.f.email} />
            </div>
            <Button type="submit" {...fs.submitOf('contacts')}>Далее: примечание</Button>
          {/snippet}
          {#snippet extra()}
            <div class="space-y-3">
              <FieldInput of={bound.f.note} />
            </div>
            <div class="flex gap-2">
              <!-- последний шаг с полями: и следующий шаг, и финальная отправка -->
              <Button type="submit" {...fs.submitOf('extra')}>Далее: готово</Button>
              <Button type="submit" variant="outline" {...fs.submitOf('save')}>Сохранить</Button>
            </div>
          {/snippet}
          {#snippet done()}
            <p class="rounded-md border p-3 text-sm">Форма сохранена — шаги закончились.</p>
          {/snippet}
        </FormSteps>
      </Form>
      <p class="text-xs text-muted-foreground">
        Шаг ведёт свой экшен (<code class="rounded bg-muted/70 px-1">subset</code>): «Далее» проверяет
        только его поля; «Сохранить» — всю форму. Провал с чужими ошибками раскрывает шаги с
        ошибками и сворачивает чистые в «Отобразить шаг N»; почините всё — разбор отпустит.
      </p>
    </div>
  {/if}

  <p class="text-xs text-muted-foreground">
    Бронь ключей глобальна: <code class="rounded bg-muted/70 px-1">step</code> — /fields,
    <code class="rounded bg-muted/70 px-1">stage</code> — авторизация,
    <code class="rounded bg-muted/70 px-1">ustep</code>/<code class="rounded bg-muted/70 px-1">lstep</code>/<code class="rounded bg-muted/70 px-1">hstep</code>/<code class="rounded bg-muted/70 px-1">fstep</code> — это демо,
    <code class="rounded bg-muted/70 px-1">demo</code> — режим панели.
  </p>
</div>
