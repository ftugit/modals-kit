<script lang="ts">
  /**
   * Координатор шагов пользовательского потока (`auth.*`, `blocked`,
   * `restrictions`, `profile`).
   *
   * Всю разметку и проверку прав несут самостоятельные компоненты на своих
   * шагах, а статус авторизации и профиль читаются и пишутся исключительно
   * через единый реактивный `vault`.
   */
  import { goto } from '$app/navigation'
  import { untrack } from 'svelte'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { formSteps, suffixOf, useSteps } from '#components/steps/index.js'
  import { kitActionTransport } from '#hooks/component-form/transport.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { defaults } from '../config.js'
  import { generateKeyPair } from '../keys.js'
  import { vault, type VaultPayload } from '../vault.svelte.js'
  import type { ProfileLimits } from './profile-form/index.js'
  import ProfileForm, { DEFAULT_PROFILE_LIMITS } from './profile-form/ProfileForm.svelte'
  import { SeedForm, seedForm, SEED_FORM_ID, SEED_FORM_REV, type SeedView } from './seed-form/index.js'
  import { prepareSeedProof } from './seed-form/prepare-proof.js'
  import { mirrorToField } from './field-mirror.svelte.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import BanNotice from './BanNotice.svelte'
  import RestrictionsNotice from './RestrictionsNotice.svelte'

  type StepData = {
    step?: 'entry' | 'register' | 'restore' | 'profile' | 'blocked' | 'restrictions' | 'done'
    user?: VaultPayload
    blocked?: { reason: string; untilMs: number | null }
    restrictions?: readonly { scope: string; reason: string; untilMs: number | null }[]
    token?: string
  }

  type AuthWidgetData = {
    challenge?: { token: string; expiresAt: number } | null
    next?: string | null
    limits?: ProfileLimits & { holdSeconds?: number }
    step?: string
    registerSeed?: string | null
    enabled?: boolean
  }

  const DEFAULT_AUTH_LIMITS: ProfileLimits & { holdSeconds: number } = {
    ...DEFAULT_PROFILE_LIMITS,
    holdSeconds: defaults.holdSeconds,
  }

  interface Props {
    data?: AuthWidgetData
    mode?: 'page' | 'modal'
    variant?: UserSurfaceVariant
    class?: string
    onDone?: () => void
  }

  let {
    data = {},
    mode = 'page',
    variant = mode === 'modal' ? 'plain' : 'card',
    class: className,
    onDone,
  }: Props = $props()

  const resolvedLimits = $derived({
    ...DEFAULT_AUTH_LIMITS,
    ...data.limits,
    holdSeconds: data.limits?.holdSeconds ?? defaults.holdSeconds,
  })
  const doneHref = $derived(data.next ?? '/')
  const authorized = $derived(vault.authorized)

  // svelte-ignore state_referenced_locally -- начальный challenge из SSR
  let challengeToken = $state(data.challenge?.token ?? '')

  const bound = bindComponentForm(forms, seedForm, {
    prepare: (fd) => prepareSeedProof(fd, challengeToken),
  })

  mirrorToField(bound, 'challenge', () => challengeToken)

  const initial = untrack(() => stepOf(bound.state.result ?? undefined) ?? ({} as StepData))
  let blocked = $state<StepData['blocked']>(initial.blocked)
  let restrictions = $state<StepData['restrictions']>(initial.restrictions)

  // svelte-ignore state_referenced_locally -- режим фиксирован на время жизни экземпляра
  const steps = useSteps({
    owner: 'auth',
    mode: mode === 'modal' ? 'local' : 'hybrid',
    key: 'stage',
    steps: () => [
      { key: 'auth', label: 'Авторизация', filled: true },
      { key: 'blocked', label: 'Блокировка' },
      { key: 'restrictions', label: 'Ограничения' },
      { key: 'profile', label: 'Профиль' },
    ],
    current: () => data.step ?? 'auth.entry',
    onSwitch: (to) => switchStep(to),
  })

  const fs = formSteps(bound, {
    steps: [
      { key: 'entry', label: 'Авторизация' },
      { key: 'register', label: 'Создать аккаунт' },
      { key: 'restore', label: 'Восстановление' },
    ],
    at: 'auth',
    host: steps,
    actionOf: (s) => (s === 'restore' ? 'restore' : 'login'),
  })

  const hostStep = $derived(steps.currentKey ?? 'auth')
  const seedView = $derived<SeedView>(
    fs.current === 'register' || fs.current === 'restore' ? fs.current : 'entry',
  )

  $effect(() => {
    const server = data.step
    if (server)
      untrack(() => {
        if (steps.fullKey !== server) steps.set(server)
      })
  })
  $effect(() => {
    if (data.challenge?.token) challengeToken = data.challenge.token
  })

  function stepOf(result?: { data?: unknown }): StepData | undefined {
    const d = result?.data as StepData | undefined
    return d && typeof d === 'object' && 'step' in d ? d : undefined
  }

  $effect(() => {
    const state = bound.state
    if (!state.result || (state.status !== 'success' && state.status !== 'error')) return
    const next = stepOf(state.result)
    if (!next) return
    if (next.user) vault.hydrate(next.user)
    if (next.step === 'done') {
      finish()
      return
    }
    untrack(() => {
      if (next.step === 'blocked' || next.step === 'restrictions' || next.step === 'profile')
        steps.set(next.step)
      blocked = next.blocked
      restrictions = next.restrictions
      if (next.token) challengeToken = next.token
      if (next.step === 'entry' || next.step === 'register' || next.step === 'restore')
        void refreshChallenge()
    })
  })

  async function refreshChallenge(): Promise<void> {
    try {
      const fd = new FormData()
      for (const pair of bound.hidden()) fd.append(pair.name, pair.value)
      fd.append('intent', 'challenge')
      const target = (visibleAddress().url.pathname || '/') + visibleAddress().url.search
      const out = await kitActionTransport(target)({
        envelope: {
          formId: SEED_FORM_ID,
          revision: SEED_FORM_REV,
          instance: `${SEED_FORM_ID}:${crypto.randomUUID()}`,
          submissionId: crypto.randomUUID(),
          intent: 'challenge',
        },
        data: fd,
        accept: ['application/json'],
        signal: new AbortController().signal,
      })
      const fresh =
        out.kind === 'result' ? (out.result.data as { token?: string } | undefined)?.token : undefined
      if (fresh) challengeToken = fresh
    } catch {
      /* останется прежний токен — сервер вернёт auth.nonce-unknown */
    }
  }

  function finish(): void {
    if (onDone) {
      onDone()
      return
    }
    void goto(doneHref)
  }

  let localSeed = $state<string | null>(null)
  const secret = $derived(localSeed ?? data.registerSeed ?? '')
  mirrorToField(bound, 'seed', () => secret)

  async function switchStep(to: string): Promise<void> {
    if (steps.fullKey === to) return
    const inner = suffixOf(to, 'auth')
    if (inner === 'register') localSeed = (await generateKeyPair()).secret
    else if (inner === 'entry') localSeed = null
    steps.set(to)
  }
</script>

{#if data.enabled === false}
  <Acl enabled={false} backHref={doneHref} {variant} class={className} />
{:else if hostStep === 'blocked'}
  <BanNotice {blocked} {authorized} backHref={doneHref} {variant} class={className} />
{:else if hostStep === 'restrictions'}
  <RestrictionsNotice
    {restrictions}
    {authorized}
    {doneHref}
    onDone={finish}
    {variant}
    class={className}
  />
{:else if hostStep === 'profile'}
  <ProfileForm
    limits={resolvedLimits}
    {authorized}
    enabled={data.enabled}
    {doneHref}
    onDone={finish}
    {variant}
    class={className}
  />
{:else}
  <SeedForm
    view={seedView}
    authorize={true}
    host={steps}
    {bound}
    {localSeed}
    holdSeconds={resolvedLimits.holdSeconds}
    {authorized}
    enabled={data.enabled}
    {doneHref}
    {variant}
    class={className}
  />
{/if}
