<script lang="ts">
  import { untrack } from 'svelte'
  import { setPageContext, type HeadSeo } from './page.svelte'
  import PageHead from './PageHead.svelte'
  import PageSeoChildFixture from './PageSeoChildFixture.test.svelte'
  import PageTitleSlot from './ui/header/PageTitleSlot.svelte'

  interface Props {
    initial?: HeadSeo
    childSeo?: HeadSeo
    renderSlotAfterChild?: boolean
  }

  let {
    initial = {
      title: 'modals-kit',
      titleSeparator: ' — ',
      siteName: 'modals-kit',
      locale: 'ru_RU',
      type: 'website',
      card: 'summary',
    },
    childSeo,
    renderSlotAfterChild = false,
  }: Props = $props()

  setPageContext(untrack(() => initial))
</script>

{#if !renderSlotAfterChild}
  <header data-testid="slot-before"><PageTitleSlot /></header>
{/if}

{#if childSeo}
  <PageSeoChildFixture seo={childSeo} />
{/if}

{#if renderSlotAfterChild}
  <header data-testid="slot-after"><PageTitleSlot /></header>
{/if}

<PageHead defaultTitle="modals-kit" />
