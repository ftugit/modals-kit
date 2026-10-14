/**
 * `#lib/address` under React Router: the four writer deps + the two router signals.
 *
 * The SvelteKit adapter (`src/lib/address/sveltekit.ts`) does the same with
 * `goto`/`page`/`popstate`. Here the router's own data model is the reality:
 * `router.state.location` (pathname, search, hash, state) and `router.subscribe`.
 * The layer-links (Navigation API) and the hash-link interceptor of the SvelteKit
 * adapter are browser glue, not router glue — they are not repeated here
 * (see the audit: they belong in a shared `address/browser.ts`).
 */
import type { DataRouter } from 'react-router'
import { createAddressWriter, type AddressWriter } from '#lib/address/index.js'

/** Memory router has no origin; the cores only read pathname/search. */
const BASE = 'http://sim.local'

export interface RouterAddress {
  readonly writer: AddressWriter
  /** The router applied a location change (after the writer heard about it). */
  onChange(fn: () => void): () => void
  dispose(): void
}

export function createRouterAddress(router: DataRouter): RouterAddress {
  const writer = createAddressWriter({
    read: () => {
      const l = router.state.location
      return { url: new URL(l.pathname + l.search, BASE), state: (l.state ?? {}) as Record<string, unknown> }
    },
    // React Router has no "shallow" navigation: `load` only matters to routers
    // that distinguish it, so both kinds go through `navigate`.
    commit: ({ href, state, replace }) => router.navigate(href, { replace, state }),
    hash: () => router.state.location.hash,
    traverse: (delta) => {
      void router.navigate(delta)
    },
  })

  const listeners = new Set<() => void>()
  let last = router.state.location
  const off = router.subscribe((state) => {
    // `subscribe` also fires for navigation/fetcher state; only a new location counts.
    if (state.location === last) return
    last = state.location
    if (state.historyAction === 'POP') writer.external()
    writer.applied()
    for (const fn of listeners) fn()
  })

  return {
    writer,
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose: off,
  }
}
