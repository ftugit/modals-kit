// Серверный POST-обработчик компонента `ProfileForm` (`#hooks/component-form`).
//
// Картинка пришла БЕЗ JS — сервер приводит её к тем же параметрам, что и
// браузерный примитив (`SpecAvatar`), и только потом пишет в профиль. Конвейер
// один (`#lib/image`); своего «аватарного» модуля у профиля больше нет.
import { image } from '#lib/image/index.js'
import { decodeWithNode } from '#lib/image/node.js'
import { localStore } from '#server/cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { createUserChecks } from '../../checks.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { createUserConfig, instruction } from '../../index.js'
import { userAuthRoute } from '../../routes.js'
import { specAvatar } from '../../spec-avatar.js'
import { profileForm } from './form.js'

const userConfig = createUserConfig(localStore.scope('user-config'))

/** Сколько байт исходника читаем заголовком: дальше решает декодер. */
const PROBE_HEAD_BYTES = 1_048_576
/** Потолок исходника до приведения: бомбу режем до декодирования. */
const MAX_SOURCE_PIXELS = 64_000_000

/** Готовый файл → `data:image/jpeg;base64,…` (текущий способ хранения профиля). */
async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type};base64,${btoa(binary)}`
}

/**
 * Привести картинку к параметрам (`SpecAvatar`) теми же ступенями, что примитив:
 * кадр `cover` и лучшее качество, влезающее в `maxBytes`.
 *
 * @returns `dataURL` готового JPEG или `null`, если не влезает/не картинка.
 */
async function prepareImage(file: File): Promise<string | null> {
  const mime = `image/${specAvatar.format}`
  try {
    const hit = await image(
      file,
      async (p) => {
        await p.frame({ width: specAvatar.width, height: specAvatar.height, fit: 'cover', method: 'lanczos3' })
        return p.fit(
          { formats: [mime], quality: [0.3, 0.95] },
          (c) => c.size <= specAvatar.maxBytes,
          { deadlineMs: 4_500, onBudgetExhausted: 'return-null' },
        )
      },
      { decoder: decodeWithNode, maxPixels: MAX_SOURCE_PIXELS },
    )
    return hit ? await toDataUrl(hit.blob) : null
  } catch {
    return null
  }
}

registerComponentForm({
  description: profileForm,
  checks: async () =>
    createUserChecks({ nicknameForbidden: await userConfig.get('nicknameForbidden') }),
  execute: async ({ values, intent, commit, fail }, event, raw) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'profile') return fail(instruction({ code: 'auth.confirm' }))

    // Защита от подмены бинарного файла строкой (включая старый base64 dataURL):
    // если в FormData под ключом `photo` прислали непустую строку вместо File — отказ.
    const rawPhotoEntry = raw?.get('photo')
    if (typeof rawPhotoEntry === 'string' && rawPhotoEntry.trim() !== '') {
      return fail(instruction({ code: 'profile.avatar-format' }))
    }

    const nickname = String(values.nickname ?? '').trim()
    const uploaded = values.photo instanceof File && values.photo.size > 0 ? values.photo : null
    const removePhoto = Boolean(values.remove_photo)

    let photoPatch: { avatarUrl?: string | null } = {}
    if (uploaded) {
      const dataUrl = await prepareImage(uploaded)
      if (!dataUrl) return fail(instruction({ code: 'profile.avatar-size' }))
      photoPatch = { avatarUrl: dataUrl }
    } else if (removePhoto) {
      photoPatch = { avatarUrl: null }
    }

    const r = await u.updateProfile({
      ...(nickname ? { nickname } : {}),
      ...photoPatch,
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
