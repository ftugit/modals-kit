<script lang="ts">
  import { useHeadSeo, type HeadSeo } from './page.svelte'

  let { seo }: { seo: HeadSeo } = $props()

  useHeadSeo(() => seo)
</script>

<div data-testid="child">ok</div>
