/**
 * `#lib/modals` under React: engine (router glue) + provider + read hooks.
 *
 * Mirrors `src/lib/modals/cores/sveltekit.ts` (engine) and the data part of
 * `svelte/ModalHost.svelte` + `svelte/state.svelte.ts`. Deliberately NOT repeated:
 * dialog UI, animation phases, floating popups, sheets — that is the 1000-line
 * presentation half of ModalHost (see the audit for what of it is logic).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import {
  buildCore,
  CHAIN_KEY,
  createModals,
  globalScope,
  resolveEntry,
  routeHref,
  runtimeKey,
  urlStorage,
  visibleChain,
  type ChainEngine,
  type ModalRegistry,
  type Modals,
  type ModalStoreData,
  type ResolvedEntry,
  type RuntimeState,
} from '#lib/modals/index.js'
// Not part of the public index — every host needs it (audit finding).
import { createLoader, type Loader } from '#lib/modals/loader.js'
import type { RouterAddress } from './address'

const isChainKey = (key: string): boolean => key === CHAIN_KEY || key.startsWith(`${CHAIN_KEY}.`)

/** Same nine fields as `svelteKitEngine()`, fed by the shared address writer. */
export function routerEngine(addr: RouterAddress, opts: { resolves?: (href: string) => boolean } = {}): ChainEngine {
  addr.writer.layerKeys(isChainKey)
  const write = (url: string, state: Record<string, unknown>, replace: boolean): void => {
    void addr.writer.write(() => ({ url, state }), { replace })
  }
  return {
    name: 'react-router',
    location() {
      const u = addr.writer.visible().url
      return { pathname: u.pathname, search: u.search }
    },
    pushState: (url, state) => write(url, state, false),
    replaceState: (url, state) => write(url, state, true),
    state: () => addr.writer.visible().state as Record<string, unknown>,
    onPopState: (fn) =>
      addr.onChange(() => {
        if (!addr.writer.traversing) fn()
      }),
    go: (delta) => addr.writer.go(delta),
    resolves: opts.resolves,
  }
}

export type ReactModals = Modals<ComponentType>

export function createRouterModals(addr: RouterAddress, opts?: { resolves?: (href: string) => boolean }): ReactModals {
  return createModals<ComponentType>(buildCore(routerEngine(addr, opts), urlStorage()))
}

/* ── provider ─────────────────────────────────────────────────────────── */

type Ctx = { modals: ReactModals; scope: ModalRegistry; loader: Loader }
const ModalsContext = createContext<Ctx | null>(null)
const InstanceContext = createContext<{ name: string; index: number } | null>(null)

function useCtx(): Ctx {
  const ctx = useContext(ModalsContext)
  if (!ctx) throw new Error('[sim] modals hook outside <ModalsProvider>')
  return ctx
}

function useStore(modals: ReactModals): ModalStoreData {
  const store = modals.store
  return useSyncExternalStore(
    store.subscribe,
    () => store.state as ModalStoreData,
    () => store.state as ModalStoreData,
  )
}

export function ModalsProvider({
  modals,
  scope = globalScope,
  children,
}: {
  modals: ReactModals
  scope?: ModalRegistry
  children?: ReactNode
}) {
  const loader = useMemo(
    () =>
      createLoader({
        store: modals.store,
        lookup: scope.lookup,
        report: (e) => modals.reportError(e),
        hrefOf: (e) => routeHref(e.definition?.route, e.params),
      }),
    [modals, scope],
  )
  useEffect(() => () => loader.dispose(), [loader])
  useEffect(() => modals.attach(), [modals])
  const value = useMemo(() => ({ modals, scope, loader }), [modals, scope, loader])
  return (
    <ModalsContext.Provider value={value}>
      {children}
      <ModalOutlet />
    </ModalsContext.Provider>
  )
}

/** Minimal presentation: one `role="dialog"` per visible entry, top one active. */
function ModalOutlet() {
  const { modals, scope, loader } = useCtx()
  const state = useStore(modals)
  const chain = visibleChain(state.chain)
  const full = state.chain
  const resolved = chain.map((entry) => resolveEntry(entry, full.indexOf(entry), scope.lookup))
  const active = resolved.at(-1) ?? null
  const activeKey = active ? `${runtimeKey(active.name, active.index)}:${JSON.stringify(active.params)}` : null
  // Loader runs only for the active entry — same rule as ModalHost's `$effect`.
  useEffect(() => (active ? loader.runLoader(active) : undefined), [activeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {resolved.map((entry) => (
        <ModalLayer key={`${entry.index}:${entry.name}`} entry={entry} top={entry === active} total={full.length} />
      ))}
    </>
  )
}

function ModalLayer({ entry, top, total }: { entry: ResolvedEntry; top: boolean; total: number }) {
  const { modals } = useCtx()
  const state = useStore(modals)
  const rt = (state.runtime[runtimeKey(entry.name, entry.index)] ?? { status: 'idle' }) as RuntimeState
  const Content = entry.definition?.component as ComponentType | undefined
  // Accessible name: the app owns the words (the Svelte host hardcodes «N из M» — audit).
  const label = total > 1 ? `${entry.name} ${entry.index + 1}/${total}` : entry.name
  return (
    <div role="dialog" aria-modal={top} aria-label={label} hidden={!top} data-modal={entry.name}>
      <InstanceContext.Provider value={{ name: entry.name, index: entry.index }}>
        {!entry.known ? (
          <p role="alert" data-modal-missing="">
            {entry.name}
          </p>
        ) : entry.definition?.loader && rt.status === 'loading' ? (
          <p aria-busy="true" data-modal-loading="" />
        ) : rt.status === 'error' ? (
          <p role="alert" data-modal-error="">
            {rt.error}
          </p>
        ) : Content ? (
          <Content />
        ) : null}
      </InstanceContext.Provider>
    </div>
  )
}

/* ── hooks (same names and meaning as `svelte/state.svelte.ts`) ───────── */

export function useModals(): ReactModals {
  return useCtx().modals
}

export function useChain() {
  return useStore(useCtx().modals).chain
}

export function useModal<P extends Record<string, unknown> = Record<string, unknown>>() {
  const instance = useContext(InstanceContext)
  if (!instance) throw new Error('[sim] useModal outside modal content')
  const { modals, scope } = useCtx()
  const chain = useStore(modals).chain
  const entry = chain[instance.index]
  const resolved = entry ? resolveEntry(entry, instance.index, scope.lookup) : null
  return {
    name: instance.name,
    index: instance.index,
    depth: chain.length,
    params: (resolved?.params ?? {}) as P,
    active: instance.index === chain.length - 1,
    close: () => modals.close(),
  }
}

export function useLoader<T = unknown>() {
  const instance = useContext(InstanceContext)
  const { modals } = useCtx()
  const state = useStore(modals)
  const key = instance ? runtimeKey(instance.name, instance.index) : 'detached:none'
  const rt = (state.runtime[key] ?? { status: 'idle' }) as RuntimeState<T>
  return {
    status: rt.status,
    data: rt.data,
    error: rt.error,
    loading: rt.status === 'loading',
    ready: rt.status === 'ready',
  }
}
