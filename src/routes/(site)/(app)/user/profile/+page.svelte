<script lang="ts">
  import { goto } from '$app/navigation'
  import ProfileForm from '#content/user/ui/ProfileForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const doneHref = $derived(data.next ?? '/user/menu')
</script>

<svelte:head><title>Профиль</title></svelte:head>

<div class="mx-auto max-w-xl px-4 py-10">
  <h1 class="mb-6 text-xl font-semibold">Профиль</h1>
  <ProfileForm
    limits={data.limits}
    initial={data.user.prof}
    {doneHref}
    onDone={() => void goto(doneHref)}
  />
</div>
