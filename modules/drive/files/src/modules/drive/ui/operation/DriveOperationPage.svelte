<script lang="ts">
  /**
   * Оболочка standalone-страниц операций «Диска» (fallback без JS).
   * Загрузчик возвращает `fact` для гостя, но POST операции отклоняется уже в
   * server action — без этой проверки гость видел бы готовую форму и кнопку.
   * Модальные близнецы закрыты `<Acl>` внутри Surface; здесь та же проверка,
   * только в карточке отдельной страницы.
   */
  import type { Snippet } from 'svelte'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DriveOperationData } from '../../types.js'

  interface Props {
    data: DriveOperationData
    children: Snippet
  }

  let { data, children }: Props = $props()
</script>

{#if data.fact}
  <div class="flex w-full justify-center">
    <Acl status={data.fact} enabled={data.enabled} backHref={data.returnTo} />
  </div>
{:else}
  <div class="mx-auto w-full max-w-xl">
    <div class="rounded-xl border border-border bg-card p-4 sm:p-6 text-card-foreground shadow-sm">
      {@render children()}
    </div>
  </div>
{/if}
