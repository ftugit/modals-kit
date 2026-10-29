// Серверный POST-обработчик управления пулом серверов боевого хранилища (`STORAGE_ACL`).
// Выполняет раннюю проверку прав (`storage.edit` / `admin`) и живой `probe` S3/WebDAV
// перед записью запечатанного `sealed_config` в `public.storage_server`.
import { localPath } from '#lib/address/index.js'
import { checkGrants, grants } from '#lib/db/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { storageServer } from '#hooks/storage-schema.js'
import { auth } from '#content/user/gateway.server.js'
import { instruction } from '#content/user/index.js'
import { removeStorageServer, saveStorageServer } from '#server/app-storage.server.js'
import { storageServerForm } from './form.js'

const gStorageServer = grants(storageServer)

registerComponentForm({
  description: storageServerForm,
  authorize: async (event) => {
    const u = auth(event)
    if (!u.enabled) return instruction({ code: 'auth.disabled' })
    const actor = await u.actor()
    if (!actor.ok) return instruction(actor.fact)
    const canMutate = checkGrants(
      { id: actor.value.id, roles: [...actor.value.permissions] },
      gStorageServer.update,
    )
    if (!canMutate) return instruction({ code: 'auth.forbidden' })
    return null
  },
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    const actor = await u.actor()
    if (!actor.ok) return fail(instruction(actor.fact))

    const parsed = storageServerForm.policy.intent.parse(intent)

    if (parsed.action === 'delete') {
      const targetId = (parsed.arg ?? '').trim()
      if (!targetId) return fail(instruction({ code: 'storage.not-found' }))
      const r = await removeStorageServer(actor.value, targetId)
      if (!r.ok) return fail(instruction(r.fact))
      commit()
      return {
        data: {
          step: 'done',
          action: 'delete',
          slice: r.value,
        },
      }
    }

    if (parsed.action === 'save') {
      const r = await saveStorageServer(actor.value, {
        id: String(values.server_id ?? '').trim() || null,
        slot: String(values.slot ?? ''),
        url: String(values.url ?? ''),
        encryptionKey: String(values.encryption_key ?? ''),
        clearEncryptionKey: Boolean(values.clear_encryption_key),
        storageMb: Number(String(values.storage_mb ?? '').trim()),
        fileMb: Number(String(values.file_mb ?? '').trim()),
        priority: Number(String(values.priority ?? '100').trim()),
        allowSplit: Boolean(values.allow_split),
        readOnly: Boolean(values.read_only),
      })
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
  redirectOnSuccess: (event) => {
    const next = localPath(event.url.searchParams.get('next'))
    if (next) return next
    return event.url.pathname + event.url.search
  },
})
