import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Error500 from '#components/Error500.svelte'
import { PageState, type HeadSeo } from './page.svelte'
import PageSeoFixture from './PageSeoFixture.test.svelte'

function collectRouteFiles(dir: string, targetName: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectRouteFiles(full, targetName, out)
    else if (entry.name === targetName) out.push(full)
  }
  return out.sort()
}

describe('PageState & useHeadSeo (SSR, реактивность, очистка слоёв)', () => {
  it('SSR: PageHead после дочернего маршрута отдаёт полный набор тегов <head>', () => {
    const { head, body } = render(PageSeoFixture, {
      props: {
        childSeo: {
          subTitle: 'Пагинатор',
          description: 'Описание витрины пагинатора.',
          url: 'https://example.com/paginator',
          image: 'https://example.com/og.png',
          imageAlt: 'Превью пагинатора',
          keywords: 'svelte, pagination',
          author: 'modals-kit',
          noindex: true,
        },
        renderSlotAfterChild: true,
      },
    })

    expect(head).toContain('<title>Пагинатор — modals-kit</title>')
    expect(head).toContain('property="og:title" content="Пагинатор — modals-kit"')
    expect(head).toContain('name="twitter:title" content="Пагинатор — modals-kit"')
    expect(head).toContain('name="description" content="Описание витрины пагинатора."')
    expect(head).toContain('property="og:description" content="Описание витрины пагинатора."')
    expect(head).toContain('name="twitter:description" content="Описание витрины пагинатора."')
    expect(head).toContain('rel="canonical" href="https://example.com/paginator"')
    expect(head).toContain('property="og:url" content="https://example.com/paginator"')
    expect(head).toContain('property="og:image" content="https://example.com/og.png"')
    expect(head).toContain('property="og:image:alt" content="Превью пагинатора"')
    expect(head).toContain('name="twitter:image:alt" content="Превью пагинатора"')
    expect(head).toContain('property="og:site_name" content="modals-kit"')
    expect(head).toContain('property="og:locale" content="ru_RU"')
    expect(head).toContain('property="og:type" content="website"')
    expect(head).toContain('name="twitter:card" content="summary"')
    expect(head).toContain('name="keywords" content="svelte, pagination"')
    expect(head).toContain('name="author" content="modals-kit"')
    expect(head).toContain('name="robots" content="noindex, nofollow"')
    expect(body).toContain('Пагинатор')
  })

  it('SSR: полный title без subTitle перекрывает базовый title, а headerTitle идёт в шапку', () => {
    const { head, body } = render(PageSeoFixture, {
      props: {
        childSeo: {
          title: 'modals-kit — главная',
          headerTitle: 'Главная',
          description: 'Главная страница.',
        },
        renderSlotAfterChild: true,
      },
    })

    const titles = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1])
    expect(titles).toEqual(['modals-kit — главная'])
    expect(body).toContain('>Главная<')
  })

  it('PageTitleSlot до монтирования страницы не показывает базовое имя сайта', () => {
    const { body } = render(PageSeoFixture, {
      props: {
        childSeo: { subTitle: 'Формы' },
        renderSlotAfterChild: false,
      },
    })

    expect(body).not.toContain('modals-kit')
    expect(body).not.toContain('<span')
  })

  it('слои SEO не текут между маршрутами и поддерживают вложенность + реактивный геттер', () => {
    const state = new PageState({
      title: 'modals-kit',
      titleSeparator: ' — ',
      siteName: 'modals-kit',
      locale: 'ru_RU',
    })

    let dynamicMode: 'single' | 'multi' = 'single'
    const offPageA = state.registerSeo(() => ({
      subTitle: dynamicMode === 'single' ? 'Выбор пользователя' : 'Выбор пользователей',
      description: 'Описание со страницы A',
      noindex: true,
    }))

    expect(state.seo.subTitle).toBe('Выбор пользователя')
    expect(state.seo.title).toBe('modals-kit')
    expect(state.seo.description).toBe('Описание со страницы A')
    expect(state.seo.noindex).toBe(true)

    dynamicMode = 'multi'
    expect(state.seo.subTitle).toBe('Выбор пользователей')

    // Переход на страницу B: новый слой монтируется, старый размонтируется
    const offPageB = state.registerSeo(() => ({
      subTitle: 'Формы',
    }))
    offPageA()

    expect(state.seo.subTitle).toBe('Формы')
    expect(state.seo.description).toBeUndefined()
    expect(state.seo.noindex).toBeUndefined()
    expect(state.seo.siteName).toBe('modals-kit')

    // Дочерний слой с полным title сбрасывает subTitle родителя, а при снятии возвращает его
    const offModal = state.registerSeo(() => ({
      title: 'modals-kit — особый экран',
    }))
    expect(state.seo.title).toBe('modals-kit — особый экран')
    expect(state.seo.subTitle).toBeUndefined()

    offModal()
    expect(state.seo.subTitle).toBe('Формы')
    expect(state.seo.title).toBe('modals-kit')

    offPageB()
    expect(state.activeSeo).toEqual({})
    expect(state.seo.subTitle).toBeUndefined()
    expect(state.seo.title).toBe('modals-kit')
  })

  it('Error500 безопасно рендерится вне setPageContext благодаря optional: true', () => {
    const { body } = render(Error500)
    expect(body).toContain('Приложение недоступно')
  })

  it('все +page.svelte проекта используют useHeadSeo и не дублируют <svelte:head>', () => {
    const root = join(process.cwd(), 'src/routes')
    const pages = collectRouteFiles(root, '+page.svelte')
    expect(pages.length).toBeGreaterThanOrEqual(10)

    const missingUseHeadSeo: string[] = []
    const duplicateRawHead: string[] = []

    for (const file of pages) {
      const content = readFileSync(file, 'utf8')
      if (!content.includes('useHeadSeo(')) missingUseHeadSeo.push(file)
      if (content.includes('<svelte:head')) duplicateRawHead.push(file)
    }

    expect(missingUseHeadSeo).toEqual([])
    expect(duplicateRawHead).toEqual([])
  })
})
