<script lang="ts">
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button, Surface } from '#core/ui/index.js'
  import { DriveDavTokens } from '#modules/drive/index.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} backHref="/user/config" />
  {:else}
    <Surface
      title="Пароли WebDAV"
      description="Подключение к диску по WebDAV: логин произвольный, пароль — из списка ниже."
      controls={{
        end: back,
      }}
    >
      <DriveDavTokens initial={data} actionBase="/user/config/dav" returnTo="/user/config/dav" />
    </Surface>
  {/if}
</div>

{#snippet back()}
  <Button href="/user/config" variant="ghost" size="sm">К настройкам</Button>
{/snippet}
