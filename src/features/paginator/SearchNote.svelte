<script lang="ts">
  // Что видно от работы lib search: подпись коррекции запроса («искали X →
  // показываем Y») и живая статистика перехватчика. Обе живут в реестрах
  // lib/search (подпись — `onSearchCorrection`, статистика — `onSearchStats`),
  // хук — тонкий слой Svelte поверх них.
  import { untrack } from 'svelte'
  import { useSearchCorrection, useSearchStats } from '$lib/search/svelte'

  interface Props {
    name: string
    /** Идёт ли сейчас перехват: выключенный поиск/источник без поиска → молчим. */
    active: boolean
  }

  let { name, active }: Props = $props()

  // Имя пагинатора стабильно на весь срок жизни компонента (демо монтируется
  // под ключом имени) — читаем его вне реактивного контекста.
  const paginatorName = untrack(() => name)
  const correction = useSearchCorrection(paginatorName)
  const stats = useSearchStats(paginatorName)
</script>

{#if active && (correction()?.changed || stats())}
  <div class="mt-2 space-y-1 text-xs text-muted-foreground">
    {#if correction()?.changed}
      <p data-testid="search-correction">
        lib/search исправил запрос: показываем результаты по <b class="text-foreground"
          >{correction()!.corrected}</b
        > — искали «{correction()!.query}».
      </p>
    {/if}
    {#if stats()}
      <p data-testid="search-stats">
        lib/search: скачано <b class="text-foreground" data-testid="stat-scanned">{stats()!.scanned}</b> ·
        подошло <b class="text-foreground" data-testid="stat-matched">{stats()!.matched}</b> · отображено
        <b class="text-foreground" data-testid="stat-emitted">{stats()!.emitted}</b> · страница источника
        <b class="text-foreground" data-testid="stat-source-page">{stats()!.sourcePage}</b>{#if stats()!.exhausted}
          · источник исчерпан{/if}
      </p>
    {/if}
  </div>
{/if}
