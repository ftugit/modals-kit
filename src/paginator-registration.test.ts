import { expect, test, vi } from 'vitest'

// Тот же корень glob, что в hooks.server.ts: в интеграции включает формы demo.
const forms = import.meta.glob('./**/*.form.server.ts')

test('загрузка форм на холодном процессе регистрирует известные поисковые списки', async () => {
  vi.resetModules()
  const { createComponentFormsHandle, ensureComponentFormsLoaded } = await import('#hooks/component-form/server.server.js')
  const { hasPaginator } = await import('#lib/paginate/index.js')
  expect(hasPaginator('user-blocks')).toBe(false)
  expect(hasPaginator('seed-users')).toBe(false)
  createComponentFormsHandle(forms)
  await ensureComponentFormsLoaded()
  expect(hasPaginator('user-blocks')).toBe(true)
  expect(hasPaginator('seed-users')).toBe(true)
  if (Object.keys(forms).some((path) => path.endsWith('/paginator/search-init.form.server.ts'))) {
    expect(hasPaginator('demo-url')).toBe(true)
  }
})
