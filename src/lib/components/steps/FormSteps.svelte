<!--
  Шаги формы (режим «паразита», `formSteps`): ВСЕ шаги всегда в DOM (поля едут
  в каждом POST формы). Обычный режим показывает ТОЛЬКО текущий шаг — соседние
  спрятаны панелью без единой кнопки (решение владельца: пока сервер не вернул
  ошибку, другой шаг недоступен). Режим разбора (серверная ошибка) закрепляет
  шаги с ошибками, чистые сворачивает в «Отобразить шаг N» — нативный
  `<details>`: раскрывается без скрипта; summary при раскрытии исчезает — блок
  его заменяет; скрыть можно только кликом мимо, с JS, или новой отправкой.

    <FormSteps host={steps} fs={fs}>
      {#snippet contacts()}
        <Field of={bound.f.name} />
      {/snippet}
    </FormSteps>
    <Button type="submit" {...fs.submit()}>{fs.isLast ? 'Сохранить' : 'Далее'}</Button>
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { StepsHost } from './steps.svelte.js'
  import type { FormStepsApi } from './form.svelte.js'

  let {
    host,
    fs,
    ...snippets
  }: { host: StepsHost; fs: FormStepsApi } & Record<string, unknown> = $props()

  const items = $derived(host.items)
  let root: HTMLDivElement | undefined = $state()

  // «Скрыть можно только нажав мимо»: с JS раскрытые details закрываются
  // щелчком вне их шага (без скрипта открытое живёт до отправки формы).
  function onOutside(e: PointerEvent) {
    if (!root || !(e.target instanceof Element)) return
    for (const d of root.querySelectorAll('details.fs-disclose[open]')) {
      if (!d.contains(e.target)) d.removeAttribute('open')
    }
  }
</script>

<div bind:this={root} onpointerdown={onOutside} role="presentation">
  {#each items as s, i (s.key)}
    {@const view = fs.viewOf(s.key)}
    {@const snip = (snippets as Record<string, Snippet | undefined>)[s.key]}
    {#if view === 'collapsed' && fs.review}
      <!-- разбор: свёрт с кнопкой раскрытия (в DOM и так был, и будет в POST) -->
      <details class="fs-disclose">
        <summary data-step-disclose={s.key}>Отобразить шаг {i + 1}<span class="fs-disclose-name"> — {s.label}</span></summary>
        <div class="fs-pane" data-step={s.key} data-step-view="open">
          {#if snip}{@render snip()}{/if}
        </div>
      </details>
    {:else}
      <!-- обычный режим: соседний шаг недоступен вовсе (только текущий);
           разбор/текущий — открытая панель. Содержимое в DOM — значения в POST -->
      <div class="fs-pane" class:fs-pane--hidden={view === 'collapsed'} data-step={s.key} data-step-view={view}>
        {#if snip}{@render snip()}{/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  /* свёрнутый шаг (без разбора — соседний недоступен вовсе): скрыт из вида и
     из фокуса, но НЕ вырезан из DOM — значения его полей едут в каждом POST */
  .fs-pane--hidden {
    display: none;
  }
  .fs-disclose summary {
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
    list-style: none;
  }
  .fs-disclose summary::-webkit-details-marker {
    display: none;
  }
  .fs-disclose summary:hover {
    color: var(--color-foreground, #09090b);
    border-style: solid;
  }
  /* «ссылка пропадает, заменённая блоком»: открытый свёрт рисует только шаг */
  .fs-disclose[open] summary {
    display: none;
  }
</style>
