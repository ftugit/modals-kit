<script lang="ts">
  import { useModalLink } from './modal-link.svelte.js'
  const link = useModalLink()
</script>
<a {...link('probe')}>Открыть</a>
