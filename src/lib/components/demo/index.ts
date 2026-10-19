/**
 * Универсальная демо-панель (`#lib/components/demo`) — один компонент на все
 * демо-страницы. Схема полей — данные; адрес (seed, коммит, бронь ключей, GET
 * без JS) панель подключает сама через `#lib/address`, наружу отдаёт параметры.
 */
export { default as DemoPanel } from './DemoPanel.svelte'
export { defineDemoPanel } from './types.js'
export type {
  DemoDivider,
  DemoField,
  DemoFieldSpec,
  DemoOption,
  DemoPanelSchema,
  DemoSelectField,
  DemoTextField,
  DemoToggleField,
  DemoUrlPolicy,
  DemoValue,
  DemoValues,
} from './types.js'
export { demoFieldSpec, demoFieldUi } from './ui.js'
export type { DemoFieldUi, DemoUiProps } from './ui.js'
export {
  demoDefaults,
  demoFields,
  demoForm,
  demoHref,
  demoParams,
  demoScenarioChange,
  demoUrlKey,
} from './schema.js'
