import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import solid from 'vite-plugin-solid'
import { nitro } from 'nitro/vite'

export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve' && mode !== 'production'

  return {
    resolve: { tsconfigPaths: true },
    server: { host: '0.0.0.0', port: 3002, strictPort: true, allowedHosts: true },
    plugins: [
      tanstackStart(),
      ...(!isDevServer ? [nitro()] : []),
      // solid's vite plugin must come after start's vite plugin
      solid({ ssr: true }),
    ],
  }
})
