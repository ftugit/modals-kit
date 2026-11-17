<script lang="ts">
  import ConfigGroupStep from './ConfigGroupStep.svelte'
  import { CONFIG_GROUPS } from '../../service/spec-config.js'
  import type { UserConfigItem, UserConfigSlice } from '../../model/types.js'

  interface Props {
    items: UserConfigItem[]
    fieldMap: Record<string, any>
    slice: UserConfigSlice
    bound: any
    active?: boolean
    showStepsNav?: boolean
  }

  let { items, fieldMap, slice, bound, active = true, showStepsNav = false }: Props = $props()
</script>

<ConfigGroupStep
  groupKey="security"
  title={CONFIG_GROUPS.security.title}
  description={CONFIG_GROUPS.security.description}
  {items}
  {fieldMap}
  {slice}
  {bound}
  {active}
  {showStepsNav}
/>
