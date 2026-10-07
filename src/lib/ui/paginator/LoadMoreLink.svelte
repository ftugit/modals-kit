<script lang="ts">
  import type { Snippet } from 'svelte'
  import { LoadMoreSlot, type LoadMoreSlotRender } from '$lib/paginate/svelte'
  import { buttonVariants } from '$lib/ui/primitives'
  import Spinner from './Spinner.svelte'

  /**
   * Ссылка/кнопка «показать ещё» — 1-в-1 с исходником
   * (`src/ui/paginator/widgets.tsx` в SolidHono): тот же набор пропов
   * (`dir`/`name`/`action`/`always`/`label`/`class`), та же разметка и никакого
   * пропа для подмены содержимого.
   *
   * Подмена была — и стоила падения: сниппет назывался `children` и затенял
   * одноимённый проп, поэтому `{#if children}{@render children(p)}`
   * компилировался в самовызов («Maximum call stack size exceeded»): ручной
   * триггер и классический режим отдавали 500 в SSR. В исходнике такого пропа
   * нет вовсе, разметка слота фиксирована — здесь то же самое.
   */
  interface Props {
    dir: 1 | -1
    name?: string
    action?: 'auto' | 'load' | 'go'
    always?: boolean
    /**
     * Подпись ссылки. В исходнике это `label?: (p) => JSX.Element` — то есть
     * разметка, а не только строка; в Svelte ей соответствует сниппет.
     */
    label?: Snippet<[LoadMoreSlotRender]>
    class?: string
  }

  let { dir, name, action = 'auto', always = false, label, class: className }: Props = $props()

  function defaultText(p: LoadMoreSlotRender): string {
    return p.dir === -1
      ? `↑ показать предыдущую страницу (${p.page})`
      : `↓ показать следующую страницу (${p.page})`
  }
</script>

<LoadMoreSlot {dir} {name} {action} {always}>
  {#snippet children(p)}
    {#snippet text(p: LoadMoreSlotRender)}
      {#if label}
        {@render label(p)}
      {:else}
        {defaultText(p)}
      {/if}
    {/snippet}
    <div class="flex justify-center py-1">
      {#if p.href !== null}
        <a
          href={p.href}
          data-testid={p.dir === -1 ? 'load-prev' : 'load-next'}
          class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
          aria-busy={p.loading}
          onclick={p.onClick}
        >
          {#if p.loading}
            <Spinner />
          {/if}
          {@render text(p)}
        </a>
      {:else}
        <button
          type="button"
          data-testid={p.dir === -1 ? 'load-prev' : 'load-next'}
          class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
          disabled={p.loading}
          onclick={() => p.load()}
        >
          {#if p.loading}
            <Spinner />
          {/if}
          {@render text(p)}
        </button>
      {/if}
    </div>
  {/snippet}
</LoadMoreSlot>
