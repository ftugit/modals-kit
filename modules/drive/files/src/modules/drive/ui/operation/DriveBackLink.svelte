<script lang="ts">
  import { untrack } from 'svelte'
  import { browser } from '$app/env'
  import { goto } from '$app/navigation'
  import { goAddress, visibleAddress } from '#core/lib/address/sveltekit.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { pageBackFrom } from './back.js'

  interface Props {
    href: string
    label?: string
  }

  let { href, label = 'Вернуться к списку' }: Props = $props()

  const m = tryUseModals()
  const target = untrack(() => href)
  const referrer = browser ? document.referrer : ''
  const current = browser ? visibleAddress().url.href : target
  const back = pageBackFrom({ referrer, current, href: target })

  function onclick(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!browser) return
    event.preventDefault()
    if (m) {
      m.modals.close()
      return
    }
    if (back === 'history') goAddress(-1)
    else void goto(target)
  }
</script>

<a {href} class="text-sm underline" onclick={onclick}>{label}</a>
