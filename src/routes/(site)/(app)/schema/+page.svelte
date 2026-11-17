<script lang="ts">
  import SchemaPage from '#sections/schema/SchemaPage.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()
</script>

<SchemaPage {data} {form} />
