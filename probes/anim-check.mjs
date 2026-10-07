/**
 * probe: анимации после перехода на встроенные кадры пресета.
 * Проверяет, что у скелетона/спиннера/каретки OTP работает ИМЕННО
 * встроенная анимация и с нужным режимом (иначе `@keyframes` из CSS
 * пропадут — произвольная форма `animate-[…]` их не печатает).
 */
import { chromium } from 'playwright'
const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ headless: true })

const slow = await browser.newPage({ viewport: { width: 1280, height: 860 } })
await slow.goto(BASE + '/modals?modal=card&modal.0.slow=true', { waitUntil: 'networkidle' })
await slow.locator('[data-modal-skeleton]').waitFor({ state: 'visible', timeout: 8000 })
await sleep(150)
const skeleton = await slow.evaluate(() => {
  const el = document.querySelector('[data-modal-skeleton-line]')
  if (!el) return null
  const cs = getComputedStyle(el)
  const kf = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } })
    .filter((r) => r.type === CSSRule.KEYFRAMES_RULE).map((r) => r.name)
  return {
    name: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount,
    keyframes: kf,
    running: cs.animationName !== 'none' && kf.includes(cs.animationName),
  }
})
console.log('скелетон:', JSON.stringify(skeleton))

const reduced = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' })
await reduced.goto(BASE + '/modals?modal=card', { waitUntil: 'networkidle' })
await sleep(300)
const reveal = await reduced.evaluate(() => {
  const el = document.querySelector('[data-modal-reveal]')
  return el ? { name: getComputedStyle(el).animationName, duration: getComputedStyle(el).transitionDuration } : null
})
console.log('reduced-motion:', JSON.stringify(reveal))
await browser.close()
