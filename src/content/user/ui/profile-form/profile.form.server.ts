// Серверный POST-обработчик компонента `ProfileForm` (`#hooks/component-form`).
// Использует изоморфный `prepareAvatar` с серверным декодером `decodeWithNode`
// из `#lib/image/node.js` без какого-либо дублирующего `server-avatar.ts`.
import { decodeWithNode } from '#lib/image/node.js'
import { localStore } from '#server/cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { createUserChecks, PHOTO_RAW_MAX_BYTES, SERVER_PHOTO_FORMATS } from '../../checks.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { createUserConfig, instruction } from '../../index.js'
import { userAuthRoute } from '../../routes.js'
import { prepareAvatar } from './avatar.js'
import { profileForm } from './form.js'

const userConfig = createUserConfig(localStore.scope('user-config'))

const SHORT_PHOTO_FORMATS = SERVER_PHOTO_FORMATS.map((mime) => mime.replace(/^image\//, ''))

async function readUserChecksSnapshot() {
  const [nicknameForbidden, avatarEdge, avatarMaxBytes] = await Promise.all([
    userConfig.get('nicknameForbidden'),
    userConfig.get('avatarEdge'),
    userConfig.get('avatarMaxBytes'),
  ])
  return { nicknameForbidden, avatarEdge, avatarMaxBytes }
}

registerComponentForm({
  description: profileForm,
  checks: async () => createUserChecks(await readUserChecksSnapshot()),
  limits: {
    maxFileSize: PHOTO_RAW_MAX_BYTES,
    maxBytes: PHOTO_RAW_MAX_BYTES + 256 * 1024,
  },
  execute: async ({ values, intent, commit, fail }, event, raw) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'profile') return fail(instruction({ code: 'auth.confirm' }))

    // Защита от подмены бинарного файла строкой (включая старый base64 dataURL):
    // если в FormData под ключом `avatar` прислали непустую строку вместо File — отказ.
    const rawAvatarEntry = raw?.get('avatar')
    if (typeof rawAvatarEntry === 'string' && rawAvatarEntry.trim() !== '') {
      return fail(instruction({ code: 'profile.avatar-format' }))
    }

    const nickname = String(values.nickname ?? '').trim()
    const uploaded = values.avatar instanceof File && values.avatar.size > 0 ? values.avatar : null
    const removeAvatar = Boolean(values.remove_avatar)

    let avatarPatch: { avatarUrl?: string | null } = {}
    if (uploaded) {
      const snapshot = await readUserChecksSnapshot()
      const prepared = await prepareAvatar(
        uploaded,
        {
          edge: snapshot.avatarEdge,
          maxBytes: snapshot.avatarMaxBytes,
          formats: SHORT_PHOTO_FORMATS,
        },
        { decoder: decodeWithNode },
      )
      if (!prepared.ok) {
        return fail(instruction({ code: prepared.code }))
      }
      avatarPatch = { avatarUrl: prepared.dataUrl }
    } else if (removeAvatar) {
      avatarPatch = { avatarUrl: null }
    }

    const r = await u.updateProfile({
      ...(nickname ? { nickname } : {}),
      ...avatarPatch,
    })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    let user: unknown
    try {
      const refreshed = await u.refreshAccess()
      if (refreshed.ok) user = await vaultPayloadOf(refreshed.value)
    } catch {
      /* профиль уже записан; обновится при штатном продлении */
    }
    return { data: { step: 'done', ...(user ? { user } : {}) } }
  },
  redirectOnSuccess: (event) => userAuthRoute.parse(event.url).next ?? '/',
})
