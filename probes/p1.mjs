import { createGenerator } from '@unocss/core'
import * as wind from '@unocss/preset-wind4'
console.log('keys', Object.keys(wind))
const preset = wind.presetWind4 ?? wind.default
const uno = await createGenerator({ presets: [preset({ preflights: { reset: false } })] })
const out = await uno.generate('flex z-200 transition-opacity duration-220 data-[starting-style]:opacity-0', { preflights: false })
console.log(JSON.stringify(out.css, null, 2))
console.log('matched', [...out.matched])
