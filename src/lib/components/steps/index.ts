/**
 * `#lib/components/steps` — шаги страницы («мастер на одном маршруте»):
 * хост `useSteps` (адрес, бронь, замок, аргументы — над `#lib/address`) и
 * `Steps` (навигация + сниппет текущего шага). Разметку шага пишет страница.
 */
export { useSteps, type StepsHost, type StepDef, type StepItem, type StepsOptions } from './steps.svelte.js'
export { default as Steps } from './Steps.svelte'
export { default as StepLink } from './StepLink.svelte'
