<!--
  Шаги формы (`formSteps`): ВСЕ шаги всегда в DOM (поля едут
  в каждом POST формы). Обычный режим показывает ТОЛЬКО текущий шаг — соседние
  спрятаны панелью без единой кнопки (решение владельца: пока сервер не вернул
  ошибку, другой шаг недоступен). Режим разбора (серверная ошибка) закрепляет
  шаги с ошибками, чистые сворачивает в «Отобразить шаг N» — нативный
  `<details>`: раскрывается без скрипта; summary при раскрытии исчезает — блок
  его заменяет; скрыть можно только кликом мимо, с JS, или новой отправкой.

    <FormSteps fs={fs}>
      {#snippet contacts()}
        <Field of={bound.f.name} />
      {/snippet}
    </FormSteps>
    <Button type="submit" {...fs.submit()}>{fs.isLast ? 'Сохранить' : 'Далее'}</Button>
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { FormStepsApi } from './form.svelte.js'

  let {
    fs,
    ...snippets
  }: { fs: FormStepsApi } & Record<string, unknown> = $props()

  const items = $derived(fs.steps)
  let root: HTMLDivElement | undefined = $state()

  // «Скрыть можно только нажав мимо»: с JS раскрытые details закрываются
  // щелчком вне их шага (без скрипта открытое живёт до отправки формы).
  function onOutside(e: PointerEvent) {
    if (!root || !(e.target instanceof Element)) return
    for (const d of root.querySelectorAll('details[open]')) {
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
      <details class="[&[open]>summary]:hidden">
        <summary
          data-step-disclose={s.key}
          class="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-dashed border-input px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-solid hover:text-foreground [&::-webkit-details-marker]:hidden"
        >Отобразить шаг {i + 1}<span> — {s.label}</span></summary>
        <div data-step={s.key} data-step-view="open">
          {#if snip}{@render snip()}{/if}
        </div>
      </details>
    {:else}
      <!-- обычный режим: соседний шаг недоступен вовсе (только текущий);
           разбор/текущий — открытая панель. Содержимое в DOM — значения в POST:
           скрытие — `hidden` (display:none), а не вырезание из разметки. -->
      <div class:hidden={view === 'collapsed'} data-step={s.key} data-step-view={view}>
        {#if snip}{@render snip()}{/if}
      </div>
    {/if}
  {/each}
</div>
