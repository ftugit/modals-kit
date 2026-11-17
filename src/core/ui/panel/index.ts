/**
 * Универсальная панель настроек: схема полей приходит данными, панель сама
 * подключает адрес (`#core/lib/address`) и отдаёт параметры.
 *
 * Историческое имя (`DemoPanel`, `demo*`) сохранено, чтобы не плодить
 * переименования в демо-страницах, но живёт панель в ядре: пагинатор ядра
 * строит на ней свою панель настроек, поэтому зависимость `core → modules/demo`
 * была бы нарушением слоя.
 */
export { default as DemoPanel } from './DemoPanel.svelte'
export {
  defineDemoPanel,
  demoDivider,
  demoPanelDefects,
  demoSelect,
  demoText,
  demoToggle,
  validateDemoPanel,
} from './define.js'
export type {
  DemoSchemaData,
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
  DemoVaultTrigger,
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
