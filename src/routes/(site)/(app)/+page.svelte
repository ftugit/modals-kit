<script lang="ts">
  import Button from '#components/ui/button/Button.svelte'
  import { useHeadSeo } from '#components/shell/index.js'
  import { asLink } from '#hooks/links/index.js'
  import SeedUsersEntry from '#content/user/ui/SeedUsersEntry.svelte'
  import StorageServersEntry from '#content/storage-servers/ui/StorageServersEntry.svelte'
  // Порт главной страницы оригинала (src/routes/_app/index.tsx):
  // сетка карточек-ссылок на демо. Состав адаптирован под страницы порта.

  useHeadSeo({
    title: 'modals-kit — главная',
    headerTitle: 'Главная',
    description:
      'Порт модальной системы SolidHono на Svelte 5 и SvelteKit: цепочка модалок в адресе, пагинатор, формы с валидацией, шаги, потоковая загрузка файлов и слой базы данных.',
  })

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
      href: '/fields',
      title: 'Конструктор полей',
      text: 'Поле формы field.fields: пользователь собирает поля с правилами, сохранённый набор снова становится формой записи.',
    },
    {
      href: '/steps',
      title: 'Шаги',
      text: 'Универсальный хост шагов: url/local/hybrid, произвольное содержимое и адрес через бронь ключей.',
    },
    {
      href: '/db-demo',
      title: 'База данных',
      text: 'Слой #lib/db внутри SvelteKit: миграции, ресурсы с политиками, form actions, '
        + 'страницы и курсоры — на PGlite в памяти и на pg через DATABASE_URL.',
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

<div class="mx-auto w-full max-w-4xl">
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
  <div class="mt-8 grid gap-4 sm:grid-cols-2">
    <SeedUsersEntry />
    <StorageServersEntry />
  </div>
  <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each demos as d (d.href)}
      <section class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xl font-semibold tracking-tight">{d.title}</h2>
        <p class="my-4 text-sm leading-relaxed text-muted-foreground">{d.text}</p>
        <Button {...asLink(d.href)}>Открыть демо</Button>
        {#if import.meta.env.DEV && d.href === '/paginator'}
          <div class="mt-3">
            <Button {...asLink('/paginator?selectTrace=1&page.src=animes')} variant="outline">
              Открыть Select trace (dev)
            </Button>
          </div>
        {/if}
      </section>
    {/each}
  </div>
</div>

