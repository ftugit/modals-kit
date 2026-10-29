// Серверный POST-обработчик компонента `UserConfig` (`user-config`).
// Набор редактируемых полей поднимается из `source(event, raw)` по реальным
// правам вызывающего и схемам ключей цели; `authorize`, `source` и `execute`
// разделяют один закэшированный срез `listUserConfig` на запрос.
import type { RequestEvent } from '@sveltejs/kit'
import { localPath } from '#lib/address/index.js'
import type { DescriptionSource } from '#lib/form/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import {
  configKeyByFieldName,
  instruction,
  type UserConfigSlice,
  type UserResult,
} from '../../index.js'
import { createUserConfigDescription, userConfigBaseForm } from './form.js'

const sliceCache = new WeakMap<RequestEvent, Promise<UserResult<UserConfigSlice>>>()

function readTargetSubject(raw: FormData): string | null {
  const val = raw.get('subject')
  return typeof val === 'string' && val.trim() ? val.trim() : null
}

function readCachedSlice(event: RequestEvent, raw: FormData): Promise<UserResult<UserConfigSlice>> {
  let cached = sliceCache.get(event)
  if (!cached) {
    cached = auth(event).listUserConfig(readTargetSubject(raw))
    sliceCache.set(event, cached)
  }
  return cached
}

function isResetIntent(raw: FormData): boolean {
  const intentRaw = raw.get(userConfigBaseForm.policy.envelopeKeys.intent)
  if (typeof intentRaw !== 'string' || !intentRaw) return false
  return userConfigBaseForm.policy.intent.parse(intentRaw).action === 'reset'
}

registerComponentForm({
  description: userConfigBaseForm,
  authorize: async (event, raw) => {
    const u = auth(event)
    if (!u.enabled) return instruction({ code: 'auth.disabled' })
    const slice = await readCachedSlice(event, raw)
    if (!slice.ok) return instruction(slice.fact)
    if (!slice.value.canSave && !isResetIntent(raw)) {
      const hasDeletable = slice.value.items.some((i) => i.deletable)
      if (!hasDeletable) return instruction({ code: 'auth.forbidden' })
    }
    return null
  },
  source: async (event, raw): Promise<DescriptionSource> => {
    const slice = await readCachedSlice(event, raw)
    const editable = slice.ok ? slice.value.items.filter((i) => i.editable) : []
    const desc = createUserConfigDescription(editable)
    return {
      revision: async () => desc.revision,
      resolve: async () => desc,
    }
  },
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))

    const parsed = userConfigBaseForm.policy.intent.parse(intent)
    const targetId = String(values.subject ?? '').trim() || null

    if (parsed.action === 'reset') {
      const resetKey = (parsed.arg ?? '').trim()
      if (!resetKey) return fail(instruction({ code: 'config.key-unknown' }))
      const r = await u.saveUserConfig({ targetId, resetKey })
      if (!r.ok) return fail(instruction(r.fact))
      commit()
      return {
        data: {
          step: 'done',
          action: 'reset',
          slice: r.value,
        },
      }
    }

    if (parsed.action === 'save') {
      const patch: Record<string, unknown> = {}
      for (const [fieldName, val] of Object.entries(values)) {
        if (fieldName === 'subject') continue
        const cfgKey = configKeyByFieldName(fieldName)
        if (!cfgKey) return fail(instruction({ code: 'config.key-unknown' }))
        patch[cfgKey] = val
      }
      const r = await u.saveUserConfig({ targetId, patch })
      if (!r.ok) return fail(instruction(r.fact))
      commit()
      return {
        data: {
          step: 'done',
          action: 'save',
          slice: r.value,
        },
      }
    }

    return fail(instruction({ code: 'auth.confirm' }))
  },
  redirectOnSuccess: (event, result) => {
    const data = result.data as { action?: string } | undefined
    if (data?.action === 'reset') {
      return event.url.pathname + event.url.search
    }
    const next = localPath(event.url.searchParams.get('next'))
    if (next) return next
    return event.url.pathname + event.url.search
  },
})
