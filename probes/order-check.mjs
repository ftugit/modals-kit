// Проверка порядка правил для переходов: shorthand не должен идти после
// longhand-ов (duration/ease), иначе он их обнулит.
//   node probes/order-check.mjs 'transition-[height]' 'duration-200' ...
import { createGenerator } from '@unocss/core'
import { presetWind4 } from '@unocss/preset-wind4'

const tokens = process.argv.slice(2)
if (!tokens.length) {
  console.error('нужны токены-классы аргументами')
  process.exit(1)
}
const uno = await createGenerator({
  presets: [presetWind4({ preflights: { reset: true } })],
})
const { css } = await uno.generate(tokens.join(' '), { preflights: false })
const rules = css
  .split('}')
  .map((chunk) => chunk.trim())
  .filter((chunk) => /transition|animation/.test(chunk))
  .map((chunk) => `${chunk.split('{')[0].trim().split('\n').pop()} → ${chunk.split('{')[1]?.trim().split(';').filter(Boolean).slice(0, 3).join('; ')}`)

console.log(rules.length ? rules.join('\n') : '(правил с transition/animation нет)')
