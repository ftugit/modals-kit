<!--
  Шаги формы (режим «паразита», `formSteps`): ВСЕ шаги всегда в DOM — свёрнутый
  прячет CSS (`display: none`), поэтому его поля едут в каждом POST формы.
  Обычный режим показывает текущий шаг; режим разбора — закрепляет шаги с
  ошибками, чистые сворачивает с кнопкой «Отобразить шаг N» (label+чекбокс:
  без скрипта раскрывает CSS, со скриптом — состояние паразита и закрытие
  кликом мимо; раскрытое руками живёт до следующей отправки формы).

    <FormSteps host={steps} fs={fs}>
      {#snippet contacts()}
        <Field of={bound.f.name} />
        <Button type="submit" {...fs.submitOf('contacts')}>Далее</Button>
      {/snippet}
    </FormSteps>
-->
<script module lang="ts">
  let seq = 0
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { StepsHost } from './steps.svelte.js'
  import type { FormStepsApi } from './form.svelte.js'

  let {
    host,
    fs,
    ...snippets
  }: { host: StepsHost; fs: FormStepsApi } & Record<string, unknown> = $props()

  const uid = `fs-${++seq}`
  const items = $derived(host.items)

  // «Скрыть можно только нажав мимо»: раскрытое юзером закрывается щелчком
  // вне его шага. Закреплённое ошибкой и текущее — не трогаем.
  function onOutside(e: PointerEvent) {
    if (!(e.target instanceof Element)) return
    for (const s of items) {
      if (fs.viewOf(s.key) === 'open' && !e.target.closest(`[data-step="${s.key}"]`)) fs.close(s.key)
    }
  }

  // «Открыто до отправки»: новый результат формы закрывает раскрытое руками.
  let seen: unknown
  $effect(() => {
    const token = fs.resultToken()
    if (seen !== undefined && token !== seen) fs.closeAll()
    seen = token
  })
</script>

{#each items as s, i (s.key)}
  {@const view = fs.viewOf(s.key)}
  {@const snip = (snippets as Record<string, Snippet | undefined>)[s.key]}
  {#if view === 'collapsed'}
    <!-- чекбокс вне потока: носитель раскрытия без скрипта, не элемент интерфейса -->
    <input id="{uid}-{s.key}" type="checkbox" class="fs-toggle" tabindex="-1" aria-hidden="true" />
    <!-- label — транспорт раскрытия без скрипта (чекбокс); со скриптом это
         кнопка: фокус, Enter/Space, клик — состояние паразита. svelte-ignore:
         интерактив label'у даёт `for`+чекбокс, слушатель клика — усиление. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <label
      class="fs-disclose"
      for="{uid}-{s.key}"
      tabindex="0"
      onclick={(e) => {
        // со скриптом — состояние паразита (тогда работает закрытие кликом мимо);
        // без скрипта обработчиков нет и label честно переключает чекбокс
        e.preventDefault()
        fs.open(s.key)
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          fs.open(s.key)
        }
      }}
    >

      Отобразить шаг {i + 1}<span class="fs-disclose-name"> — {s.label}</span>
    </label>
  {/if}
  <div class="fs-pane" class:fs-pane--hidden={view === 'collapsed'} data-step={s.key} data-step-view={view}>
    {#if snip}{@render snip()}{/if}
  </div>
{/each}

<svelte:window onpointerdown={onOutside} />

<style>
  /* чекбокс скрыт физически (не display:none — по нему кликает label) */
  .fs-toggle {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* свёрнут шагом скрыт из вида и из фокуса, но НЕ вырезан из DOM:
     значения его полей по-прежнему уходят с каждым POST формы */
  .fs-pane--hidden {
    display: none;
  }
  /* без скрипта: чекбокс от label раскрывает панель и прячет кнопку */
  .fs-toggle:checked ~ .fs-pane--hidden {
    display: block;
  }
  .fs-toggle:checked ~ .fs-disclose {
    display: none;
  }
  .fs-disclose {
    display: inline-flex;
    gap: 0.25rem;
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1.25rem;
    font-weight: 500;
    padding: 0.375rem 0.75rem;
    border: 1px dashed var(--color-input, #d4d4d8);
    border-radius: 0.375rem;
    color: var(--color-muted-foreground, #71717a);
  }
  .fs-disclose:hover {
    color: var(--color-foreground, #09090b);
    border-style: solid;
  }
</style>
