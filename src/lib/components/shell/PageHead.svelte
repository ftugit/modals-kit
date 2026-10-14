<script lang="ts">
  // SEO-компонент страницы: генерирует title, description, OG, Twitter Cards, Canonical.
  import { usePage } from './page.svelte'

  let { defaultTitle = 'dd application' }: { defaultTitle?: string } = $props()

  const page = usePage()

  const fullTitle = $derived.by(() => {
    const { title, subTitle, titleSeparator = ' | ' } = page.seo
    if (subTitle && title) return `${subTitle}${titleSeparator}${title}`
    return subTitle ?? title ?? defaultTitle
  })
</script>

<svelte:head>
  <title>{fullTitle}</title>
  {#if page.seo.description}
    <meta name="description" content={page.seo.description} />
    <meta property="og:description" content={page.seo.description} />
    <meta name="twitter:description" content={page.seo.description} />
  {/if}
  <meta property="og:title" content={fullTitle} />
  <meta name="twitter:title" content={fullTitle} />
  {#if page.seo.image}
    <meta property="og:image" content={page.seo.image} />
    <meta name="twitter:image" content={page.seo.image} />
  {/if}
  {#if page.seo.url}
    <link rel="canonical" href={page.seo.url} />
    <meta property="og:url" content={page.seo.url} />
  {/if}
  {#if page.seo.type}
    <meta property="og:type" content={page.seo.type} />
  {/if}
  {#if page.seo.card}
    <meta name="twitter:card" content={page.seo.card} />
  {/if}
  {#if page.seo.keywords}
    <meta name="keywords" content={page.seo.keywords} />
  {/if}
  {#if page.seo.author}
    <meta name="author" content={page.seo.author} />
  {/if}
  {#if page.seo.siteName}
    <meta property="og:site_name" content={page.seo.siteName} />
  {/if}
</svelte:head>
