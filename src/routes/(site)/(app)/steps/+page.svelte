<script lang="ts">
  // Демо универсального хода шагов (lib/components/steps): один хост — четыре
  // режима: адресные (url/local/hybrid) и форм-режим (шаги поверх ОДНОЙ формы,
  // «паразит» formSteps). Нарезку трёх РАЗНЫХ форм смотрите на /fields.
  import { page } from '$app/state'
  import { untrack } from 'svelte'
  import { Steps, StepLink, FormSteps, formSteps, useSteps } from '#lib/components/steps/index.js'
  import { bind } from '#lib/form/svelte/index.js'
  import Field from '#lib/components/form/Field.svelte'
  import Form from '#lib/form/svelte/Form.svelte'
  import Common from '#lib/components/form/Common.svelte'
  import { Button } from '#lib/components/ui/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import { FSTEP_STEPS, fstepForm, type FstepStep } from './fstep-form.ts'
  import type { Result } from '#lib/form/index.js'

  let { form: action }: { form?: { result?: Result; step?: FstepStep } | null } = $props()

  const DEFS = () => [
    { key: 'compose', label: 'Состав', filled: true },
    { key: 'confirm', label: 'Подтверждение', filled: true },
    { key: 'done', label: 'Готово', filled: true },
  ]

  // Бронь ключей глобальна на приложение (lib/address/keys): демо живёт на своей
  // странице и берёт СВОИ ключи — заодно видно опцию `key`.
  // 1. url: истина в адресе — ссылки, deep-link, обновление страницы
  const urlSteps = useSteps({
    owner: 'steps-demo-url',
    mode: 'url',
    key: 'ustep',
    steps: DEFS,
    current: () => (page.url.searchParams.get('ustep') ?? 'compose'),
  })

  // 2. local: состояние в хосте, адрес не пишется (сценарий модалки)
  const localSteps = useSteps({
    owner: 'steps-demo-local',
    mode: 'local',
    key: 'lstep',
    steps: DEFS,
    current: () => 'compose',
  })

  // 3. hybrid: локальная смена + мягкая синхронизация адреса своим ключом
  //    брони (pushState без навигации) — обновление страницы держит шаг
  const hybridSteps = useSteps({
    owner: 'steps-demo-hybrid',
    mode: 'hybrid',
    key: 'hstep',
    steps: DEFS,
    current: () => (page.url.searchParams.get('hstep') ?? 'compose'),
  })

  const TEXT: Record<string, string> = {
    compose: 'Шаг «Состав»: произвольное содержимое — хост не знает про форму.',
    confirm: 'Шаг «Подтверждение»: контент переключает сам потребитель ({#if}-ветки).',
    done: 'Шаг «Готово»: адресные шаги глубоко ссылаемы, локальные — нет.',
  }
  const address = $derived(page.url.pathname + page.url.search)

  // 4. form: шаги поверх ОДНОЙ формы. Смена шага — submit (интенция экшена),
  //    свёрнутый шаг скрыт CSS-ом и едет в каждом POST, валидаторы шага —
  //    subset экшена. Ответ экшена несёт шаг (успех — следующий, провал — свой).
  // шаг: ответ экшена без JS приезжает в проп `form`, с JS — в результат
  // привязки (Result.data.step). Провал без данных — остаёмся на текущем.
  const stepOfResult = (r?: Result): FstepStep | null => {
    const d = r?.data as { step?: FstepStep } | undefined
    return d && typeof d.step === 'string' ? d.step : null
  }
  // начальное значение — ТОЛЬКО первый рендер (SSR no-JS ответ); дальше шагом
  // ведёт эффект ниже и local-хост, поэтому чтение пропа здесь — намеренное
  // svelte-ignore state_referenced_locally
  let fstep = $state<FstepStep>(action?.step ?? 'contacts')
  $effect(() => {
    fstep = action?.step ?? stepOfResult(bound.state.result) ?? fstep
  })
  const formStepsHost = useSteps({
    owner: 'steps-demo-form',
    mode: 'local',
    steps: () => FSTEP_STEPS.map((s) => ({ ...s, filled: true })),
    current: () => fstep,
  })
  // однонаправленная память шага: local-хост берёт начальное значение из
  // `current()` и дальше ведёт состояние сам (set), странице остаётся ответ
  const bound = bind(forms, fstepForm, {
    action: '/steps',
    transport: kitActionTransport('/steps'),
    continuation: untrack(() => action?.result ?? null),
  })
  const fs = formSteps(bound, formStepsHost)
</script>

<svelte:head>
  <title>Шаги — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-10 py-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">Шаги</h1>
    <p class="text-muted-foreground">
      Один хост (`useSteps`), три режима, произвольное содержимое. Нарезку формы с полями
      между шагами — демо <a class="underline underline-offset-4" href="/fields">/fields</a>.
    </p>
  </header>

  <section class="space-y-3">
    <h2 class="text-lg font-semibold">1. Режим url — истина в адресе</h2>
    <p class="text-sm text-muted-foreground">
      Ссылки меняют адрес (`?step=…`), переход — навигация. Обновление страницы и deep-link работают сами.
    </p>
    <div class="flex items-baseline gap-4">
      <Steps host={urlSteps} label="Шаги демо" />
    </div>
    <Steps host={urlSteps} label="" nav={false}>
      {#snippet compose()}<p class="rounded-md border p-3 text-sm">{TEXT.compose}</p>{/snippet}
      {#snippet confirm()}<p class="rounded-md border p-3 text-sm">{TEXT.confirm}</p>{/snippet}
      {#snippet done()}<p class="rounded-md border p-3 text-sm">{TEXT.done}</p>{/snippet}
    </Steps>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-semibold">2. Режим local — состояние без адреса</h2>
    <p class="text-sm text-muted-foreground">
      Смена — <code>set()</code>, адрес не пишется (сценарий модалок). Текущий адрес ниже не меняется.
    </p>
    <div class="flex items-baseline gap-4">
      <Steps host={localSteps} label="Шаги демо" />
    </div>
    <Steps host={localSteps} label="" nav={false}>
      {#snippet compose()}<p class="rounded-md border p-3 text-sm">{TEXT.compose}</p>{/snippet}
      {#snippet confirm()}<p class="rounded-md border p-3 text-sm">{TEXT.confirm}</p>{/snippet}
      {#snippet done()}<p class="rounded-md border p-3 text-sm">{TEXT.done}</p>{/snippet}
    </Steps>
    <p class="font-mono text-xs text-muted-foreground">адрес: {address}</p>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-semibold">3. Режим hybrid — локальная смена + адрес</h2>
    <p class="text-sm text-muted-foreground">
      Шаг меняется локально (без навигации и load), адрес синхронизируется своим ключом
      брони (<code>?hstep=…</code> — чужие ключи адреса не тронуты). Обновите
      страницу — шаг останется.
    </p>
    <div class="flex items-baseline gap-4">
      <Steps host={hybridSteps} label="Шаги демо" />
      <!-- свой вид: ссылка в облике кнопки (Button сам рисует <a> по href);
           no-JS разметка остаётся ссылкой -->
      {#if hybridSteps.currentKey !== 'done'}
        <StepLink host={hybridSteps} step="done" element="button" variant="outline">К «Готово» кнопкой</StepLink>
      {/if}
    </div>
    <Steps host={hybridSteps} label="" nav={false}>
      {#snippet compose()}<p class="rounded-md border p-3 text-sm">{TEXT.compose}</p>{/snippet}
      {#snippet confirm()}<p class="rounded-md border p-3 text-sm">{TEXT.confirm}</p>{/snippet}
      {#snippet done()}<p class="rounded-md border p-3 text-sm">{TEXT.done}</p>{/snippet}
    </Steps>
    <p class="font-mono text-xs text-muted-foreground">адрес: {address}</p>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-semibold">4. Режим form — шаги поверх одной формы</h2>
    <p class="text-sm text-muted-foreground">
      Одна форма (`bind` один), шаги — её нарезка. Смена шага — submit с интенцией
      (`subset` экшена включает валидаторы шага), свёрнутый шаг скрыт CSS-ом, но его
      поля едут в каждом POST. Сломайте финальное «Сохранить» (имя <code>ошибка</code> —
      ошибка только на сервере): шаг с ошибкой раскроется, чистые свернутся в
      «Отобразить шаг N». Адрес не участвует.
    </p>
    <Form id="fstep" form={bound} hiddenFields={bound.hidden()}>
      <!-- общие ошибки видны всегда: в разборе без полевых ошибок шаги свёрнуты,
           и блок остаётся единственным сигналом -->
      <Common errors={bound.common} title="Форма не сохранена" />
      <FormSteps host={formStepsHost} fs={fs}>
        {#snippet contacts()}
          <div class="space-y-3">
            <Field of={bound.f.name} />
            <Field of={bound.f.email} />
          </div>
          <Button type="submit" {...fs.submitOf('contacts')}>Далее: примечание</Button>
        {/snippet}
        {#snippet extra()}
          <div class="space-y-3">
            <Field of={bound.f.note} />
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
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold">Опции хоста</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li><code>owner</code> — владелец брони ключа; пишет только свой ключ адреса, чужие (`?modal=`, `?page.…`) не теряются.</li>
      <li><code>mode</code> — где живёт состояние: <code>url</code> (адрес, умолчание), <code>local</code> (модалки), <code>hybrid</code> (локальная смена + адрес).</li>
      <li><code>key</code> — имя ключа адреса (умолчание `step`).</li>
      <li><code>steps</code> — адресуемые шаги (ключ, подпись, `filled`); служебные состояния вне списка адреса не получают.</li>
      <li><code>current</code> — в `url` истина на каждом чтении; в `local`/`hybrid` — начальное значение (данные загрузки, deep-link).</li>
      <li><code>lockKey</code> — замок полёта отправки в `page.state`: ссылки видимые, но некликабельные.</li>
      <li><code>set(key)</code> — локальная смена; в `hybrid` адресуемый шаг синхронизирует адрес, замок игнорирует смену.</li>
      <li><code>href/arg/argHref</code> — адрес шага и аргументы (<code>step.ключ.имя</code>) через бронь.</li>
    </ul>
  </section>
</div>
