import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `#lib/*` is the root package's subpath import; files under sim/ live in another
// package scope, so the alias points at the same folder explicitly.
const lib = fileURLToPath(new URL('../../src/lib', import.meta.url))

export default defineConfig({
  resolve: { alias: [{ find: /^#lib\/(.*)$/, replacement: `${lib}/$1` }] },
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
})
