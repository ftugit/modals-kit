<script lang="ts">
  // Что видно от работы lib search: подпись коррекции запроса («искали X →
  // показываем Y») и живая статистика перехватчика. Обе — из lib search:
  // подпись через реестр (`onSearchCorrection`), статистика — от перехватчика
  // выбранного источника (см. `definition.ts`).
  import { untrack } from 'svelte'
  import { useSearchCorrection } from '$lib/search/svelte'
  import { getSearchStats, onSearchStats, type DemoSearchStats } from './definition'

  interface Props {
    name: string
    /** Идёт ли сейчас перехват: выключенный поиск или выключенный lib/search → молчим. */
    active: boolean
  }

  let { name, active }: Props = $props()

  // Имя пагинатора стабильно на весь срок жизни компонента (демо монтируется
  // под ключом имени) — читаем его вне реактивного контекста.
  const paginatorName = untrack(() => name)
  const correction = useSearchCorrection(paginatorName)
  let stats = $state<DemoSearchStats>(getSearchStats(paginatorName))

  $effect(() => {
    stats = getSearchStats(paginatorName)
    return onSearchStats(paginatorName, (next) => {
      stats = next
    })
  })
</script>

{#if active && (correction()?.changed || stats)}
  <div class="mt-2 space-y-1 text-xs text-muted-foreground">
    {#if correction()?.changed}
      <p data-testid="search-correction">
        lib/search исправил запрос: показываем результаты по <b class="text-foreground"
          >{correction()!.corrected}</b
        > — искали «{correction()!.query}».
      </p>
    {/if}
    {#if stats}
      <p data-testid="search-stats">
        lib/search: скачано <b class="text-foreground" data-testid="stat-scanned">{stats.scanned}</b> ·
        подошло <b class="text-foreground" data-testid="stat-matched">{stats.matched}</b> · отображено
        <b class="text-foreground" data-testid="stat-emitted">{stats.emitted}</b> · страница источника
        <b class="text-foreground" data-testid="stat-source-page">{stats.sourcePage}</b>{#if stats.exhausted}
          · источник исчерпан{/if}
      </p>
    {/if}
  </div>
{/if}
