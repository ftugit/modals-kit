<!--
  Шаги формы (режим «паразита», `formSteps`): ВСЕ шаги всегда в DOM — свёрнутый
  шаг спрятан нативным `<details>` (содержимое закрытого details не видно и не
  в фокусе, но в DOM), поэтому его поля едут в каждом POST формы. Обычный режим
  показывает текущий шаг; режим разбора — закрепляет шаги с ошибками, чистые
  сворачивает в «Отобразить шаг N» (details/summary: раскрывается без скрипта;
  summary при раскрытии исчезает — блок его заменяет; скрыть можно только кликом
  мимо, с JS, или новой отправкой — открытые живут до отправки формы).

    <FormSteps host={steps} fs={fs}>
      {#snippet contacts()}
        <Field of={bound.f.name} />
        <Button type="submit" {...fs.submitOf('contacts')}>Далее</Button>
      {/snippet}
    </FormSteps>
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
    {#if view === 'collapsed'}
      <!-- свёрт: содержимое в DOM (значения едут в POST), вида нет до щелчка -->
      <details class="fs-disclose">
        <summary data-step-disclose={s.key}>Отобразить шаг {i + 1}<span class="fs-disclose-name"> — {s.label}</span></summary>
        <div class="fs-pane" data-step={s.key} data-step-view="open">
          {#if snip}{@render snip()}{/if}
        </div>
      </details>
    {:else}
      <div class="fs-pane" data-step={s.key} data-step-view={view}>
        {#if snip}{@render snip()}{/if}
      </div>
    {/if}
  {/each}
</div>

<style>
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
