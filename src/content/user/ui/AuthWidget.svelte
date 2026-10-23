<script lang="ts">
  /**
   * Координатор шагов пользовательского потока (`auth.*`, `blocked`,
   * `restrictions`, `profile`).
   *
   * Всю разметку и проверку прав несут самостоятельные компоненты на своих
   * шагах, а `variant` и `class` прокидываются по цепочке в любой активный
   * передний блок (`Acl`, `BanNotice`, `RestrictionsNotice`, `ProfileForm`, `SeedForm`):
   *   - `auth.*` (`entry` | `register` | `restore`) → `SeedForm` (`authorize={true}`, `Acl allow="guest"`);
   *   - `blocked` → `BanNotice` (`Acl allow="guest"`);
   *   - `restrictions` → `RestrictionsNotice` (`Acl allow="user"`);
   *   - `profile` → `ProfileForm` (`Acl allow="user"`).
   */
  import { goto } from '$app/navigation'
  import { untrack } from 'svelte'
  import { formSteps, suffixOf, useSteps } from '#lib/components/steps/index.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { generateKeyPair, sign } from '../keys.js'
  import { hydrateVault, readUser } from '../vault.svelte.js'
  import type { AvatarLimits } from './profile-form/index.js'
  import ProfileForm from './profile-form/ProfileForm.svelte'
  import { SeedForm, seedForm, SEED_FORM_ID, SEED_FORM_REV, type SeedView } from './seed-form/index.js'
  import { mirrorToField } from './field-mirror.svelte.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'
  import BanNotice from './BanNotice.svelte'
  import RestrictionsNotice from './RestrictionsNotice.svelte'

  type UserPayload = {
    access: string
    expiresAt: number
    ttlMs: number
    sub: string
    prof: { nickname: string | null; avatarUrl: string | null }
  }

  type StepData = {
    step?: 'entry' | 'register' | 'restore' | 'profile' | 'blocked' | 'restrictions' | 'done'
    user?: UserPayload
    blocked?: { reason: string; untilMs: number | null }
    restrictions?: readonly { scope: string; reason: string; untilMs: number | null }[]
    nonce?: string
  }

  interface Props {
    data: {
      challenge: { nonce: string; expiresAt: number } | null
      next: string | null
      limits: AvatarLimits & { holdSeconds: number }
      step: string
      registerSeed?: string | null
      enabled?: boolean
      user?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
    }
    mode?: 'page' | 'modal'
    variant?: UserSurfaceVariant
    class?: string
    onDone?: () => void
  }

  let {
    data,
    mode = 'page',
    variant = mode === 'modal' ? 'plain' : 'card',
    class: className,
    onDone,
  }: Props = $props()

  const doneHref = $derived(data.next ?? '/')
  const currentUser = $derived(readUser(data.user))
  const authorized = $derived(currentUser !== null)

  // svelte-ignore state_referenced_locally -- начальный challenge из SSR
  let nonce = $state(data.challenge?.nonce ?? '')

  const bound = bindComponentForm(forms, seedForm, {
    prepare: async (fd) => {
      const typed = String(fd.get('seed') ?? '').trim()
      fd.set('seed', typed)
      if (typed.length >= 43 && typed.length <= 44 && nonce !== '') {
        try {
          fd.set('signature', await sign(nonce, typed))
        } catch {
          /* в поле публичный seed — сервер ответит auth.signature */
        }
      }
    },
  })

  mirrorToField(bound, 'nonce', () => nonce)

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
    if (data.challenge?.nonce) nonce = data.challenge.nonce
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
    if (next.user) hydrateVault(next.user)
    if (next.step === 'done') {
      finish()
      return
    }
    untrack(() => {
      if (next.step === 'blocked' || next.step === 'restrictions' || next.step === 'profile')
        steps.set(next.step)
      blocked = next.blocked
      restrictions = next.restrictions
      if (next.nonce) nonce = next.nonce
      if (next.step === 'entry' || next.step === 'register' || next.step === 'restore')
        void refreshChallenge()
    })
  })

  const challengeTransport = kitActionTransport('/user/auth')

  async function refreshChallenge(): Promise<void> {
    try {
      const fd = new FormData()
      for (const pair of bound.hidden()) fd.append(pair.name, pair.value)
      fd.append('intent', 'challenge')
      const out = await challengeTransport({
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
        out.kind === 'result' ? (out.result.data as { nonce?: string } | undefined)?.nonce : undefined
      if (fresh) nonce = fresh
    } catch {
      /* останется прежний nonce — сервер вернёт auth.nonce-unknown */
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
    limits={data.limits}
    initial={currentUser?.prof ?? null}
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
    holdSeconds={data.limits.holdSeconds}
    {authorized}
    enabled={data.enabled}
    {doneHref}
    {variant}
    class={className}
  />
{/if}
