<script lang="ts">
  // Порт главной страницы оригинала (src/routes/_app/index.tsx):
  // сетка карточек-ссылок на демо. Состав адаптирован под страницы порта.

  const demos = [
    {
      href: '/modals',
      title: 'Модальные окна',
      text: 'Стек окон, URL-состояние, загрузка и полноэкранная версия карточки.',
    },
    {
      href: '/paginator',
      title: 'Пагинатор',
      text: 'Headless-пагинация, URL/localStorage персист, скролл-сентинелы, якоря и раскладки.',
    },
    {
      href: '/form',
      title: 'Формы',
      text: 'Формы со строгой валидацией, генерацией полей и серверными слоями.',
    },
    {
      href: '/cycle',
      title: 'Полный цикл',
      text: 'Объявление → вызов с параметрами → цепочка → адрес → Назад: цикл жизни записи без хоста.',
    },
    {
      href: '/spike',
      title: 'Спайк истории',
      text: 'Песочница модели истории: ?modal= и transient в page.state, сырой history.state.',
    },
  ]
</script>

<svelte:head>
  <title>modals-kit — главная</title>
</svelte:head>

<div class="py-10 sm:py-12">
  <div class="max-w-3xl">
    <span
      class="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
    >
      SvelteKit · Ark · порт SolidHono
    </span>
    <h1 class="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">modals-kit</h1>
    <p class="mt-5 text-lg leading-relaxed text-muted-foreground">
      Порт модальной системы SolidHono: цепочка живёт в адресе, стопка с хвостами,
      загрузчик работает до открытия, Назад/Вперёд закрывают и открывают модалки.
    </p>
  </div>
  <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each demos as d (d.href)}
      <section class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xl font-semibold tracking-tight">{d.title}</h2>
        <p class="my-4 text-sm leading-relaxed text-muted-foreground">{d.text}</p>
        <a
          href={d.href}
          class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Открыть демо
        </a>
      </section>
    {/each}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: var(--background);
    color: var(--foreground);
    font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
  }
</style>
