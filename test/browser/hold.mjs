// Общий хелдер удержания для браузерных сьютов. Держит Space/Enter на
// HoldButton и ждёт реального исхода (ответ формы, редирект), а не слепого
// sleep: `until` — обещание, которое разрешается, когда действие сработало.
// Кнопка обязана быть настоящим HoldButton (`data-mass-hold`), иначе мутация
// «заменить на обычную Button» проходит незамеченной.
import assert from 'node:assert/strict'

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 * @param {Promise<unknown>} until исход действия (waitForResponse/waitForURL)
 * @param {{ key?: string, timeout?: number, massHold?: boolean }} [opts]
 */
export async function hold(page, locator, until, opts = {}) {
  const key = opts.key ?? ' '
  await locator.waitFor({ state: 'visible', timeout: opts.timeout ?? 15000 })
  if (opts.massHold !== false) {
    assert.equal(
      await locator.getAttribute('data-mass-hold'),
      'true',
      'удержание ожидается на HoldButton (data-mass-hold), а не на обычной кнопке/ссылке',
    )
  }
  await locator.focus()
  await page.keyboard.down(key)
  try {
    await until
  } finally {
    await page.keyboard.up(key)
  }
}
