import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve' && mode !== 'production'

  return {
    resolve: { tsconfigPaths: true },
    server: { host: '0.0.0.0', port: 3001, strictPort: true, allowedHosts: true },
    plugins: [
      tanstackStart(),
      ...(!isDevServer ? [nitro()] : []),
      // react's vite plugin must come after start's vite plugin
      viteReact(),
    ],
  }
})
