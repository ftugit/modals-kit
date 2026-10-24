/**
 * `stepLink` — сделать элемент ссылкой на шаг (паттерн `asLink` из
 * `hooks/links`): вид даёт сам элемент.
 *
 *   <a {...stepLink(steps, 'register')}>Регистрация</a>
 *   <Button {...stepLink(steps, 'register')} variant="outline">Регистрация</Button>
 *
 * Атрибуты несут `href` — fallback БЕЗ JS: честный адрес шага, браузер без
 * скриптов делает нативный переход. С JS элемент с ключом `href` (Button)
 * рисуется `<a>`; перехват клика — в attachment:
 *  - режим `url` — клик не трогаем (смена = нативная навигация);
 *  - local/hybrid — `preventDefault` + `host.switch()` (локальная смена,
 *    побочные данные — `onSwitch` хоста);
 *  - во время полёта отправки (замок) — `aria-disabled` и клик гасится;
 *  - модификаторы/средняя кнопка — браузеру (открыть в новой вкладке).
 *
 * Для `<a>`-в-облике-кнопки: `<Button {...stepLink(...)}>` — у Button `href`
 * переключает `<a>`/`<button>`; no-JS разметка отдаёт ссылку.
 */
import { createAttachmentKey } from 'svelte/attachments'
import { isModified } from '#hooks/links/state.svelte.js'
import type { StepsHost } from './steps.svelte'

const STEPS = createAttachmentKey()

export interface StepLinkAttrs {
  /** Адрес шага: fallback без JS; `Button` по ключу `href` рисует `<a>`. */
  href: string
  'data-step-link': ''
  'aria-disabled'?: 'true'
  [STEPS]: (el: HTMLElement) => () => void
}

export function stepLink(host: StepsHost, step: string): StepLinkAttrs {
  const locked = host.locked
  return {
    href: host.href(step),
    'data-step-link': '',
    ...(locked ? { 'aria-disabled': 'true' } : {}),
    [STEPS]: (el: HTMLElement) => {
      const onClick = (e: MouseEvent) => {
        if (host.mode === 'url') return       // смена — нативная навигация по href
        if (locked || e.defaultPrevented || isModified(e)) return
        e.preventDefault()
        void host.switch(step)
      }
      el.addEventListener('click', onClick)
      return () => el.removeEventListener('click', onClick)
    },
  }
}

export { STEPS as STEP_LINK }
