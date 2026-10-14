import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/** Render into a fresh container; every update goes through act(). */
export async function mount(node: ReactNode) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  await act(async () => root.render(node))
  return {
    el,
    async unmount() {
      await act(async () => root.unmount())
      el.remove()
    },
  }
}

/** Let promises, router navigations and React updates settle. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}

export async function click(el: Element | null) {
  if (!el) throw new Error('click: element not found')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

/** Run an outside-React action (router.navigate, core call) inside act(), then settle. */
export async function run(fn: () => unknown) {
  await act(async () => {
    await fn()
  })
  await settle()
}

export const q = (root: ParentNode, selector: string) => root.querySelector(selector)
