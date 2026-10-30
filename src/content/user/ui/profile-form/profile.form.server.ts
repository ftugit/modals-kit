// Серверный POST-обработчик компонента `ProfileForm` (`#hooks/component-form`).
//
// Готовый сжатый кадр сохраняется в боевое хранилище приложения (`saveManagedAvatar`)
// под уникальным неизменяемым путём `avatars/<uid>/<hash>-<nonce>.<ext>`, а в БД
// профиля и куку `auth_tmp` ложится короткая ссылка `/api/storage/avatars/…`.
// При замене или снятии фото прежний файл физически удаляется сразу (`storage.remove`).
//
// Защита RAM:
// - `preAuthorize(event)` отбивает анонима и протухшую сессию на `0` прочитанных байтах тела;
// - `authorize(event, raw)` проверяет право правки чужого `subject` до `imageCheck`/`avatar-spec`;
// - `limits.budget` ужимает потолок HTTP POST формы с `1 МБ + 20 КБ` до `36 КБ` (`20 КБ` кадр + `16 КБ` конверт).
import type { RequestEvent } from '@sveltejs/kit'
import { fitsSpec } from './spec-fit.js'
import { removeManagedAvatarByUrl, saveManagedAvatar } from '#server/app-storage.server.js'
import { localStore } from '#server/cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { createUserChecks } from '../../checks.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { createUserConfig, instruction } from '../../index.js'
import { userAuthRoute } from '../../routes.js'
import { specAvatar } from '../../spec-avatar.js'
import { IMAGE_RAW_MAX_BYTES, profileForm } from './form.js'

const userConfig = createUserConfig(localStore.scope('user-config'))

/** Суммарный потолок HTTP POST для формы профиля: готовый кадр (20 КБ) + конверт и поля (16 КБ). */
export const PROFILE_HTTP_BUDGET = IMAGE_RAW_MAX_BYTES + 16 * 1024

type ActorPromise = ReturnType<ReturnType<typeof auth>['actor']>
const actorCache = new WeakMap<RequestEvent, ActorPromise>()

function readCachedActor(event: RequestEvent): ActorPromise {
  let cached = actorCache.get(event)
  if (!cached) {
    cached = auth(event).actor()
    actorCache.set(event, cached)
  }
  return cached
}

registerComponentForm({
  description: profileForm,
  limits: {
    budget: PROFILE_HTTP_BUDGET,
  },
  preAuthorize: async (event) => {
    const u = auth(event)
    if (!u.enabled) return instruction({ code: 'auth.disabled' })
    const actorRes = await readCachedActor(event)
    if (!actorRes.ok) return instruction(actorRes.fact)
    return null
  },
  authorize: async (event, raw) => {
    const u = auth(event)
    if (!u.enabled) return instruction({ code: 'auth.disabled' })
    const actorRes = await readCachedActor(event)
    if (!actorRes.ok) return instruction(actorRes.fact)
    const subject = String(raw.get('subject') ?? '').trim() || undefined
    if (subject && subject !== actorRes.value.id) {
      const checkAccess = await u.profile(subject)
      if (!checkAccess.ok) return instruction(checkAccess.fact)
      if (!checkAccess.value.canEdit) return instruction({ code: 'auth.forbidden' })
    }
    return null
  },
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
      return fail(instruction({ code: 'profile.photo-format' }))
    }

    const actorRes = await readCachedActor(event)
    if (!actorRes.ok) return fail(instruction(actorRes.fact))

    const nickname = String(values.nickname ?? '').trim()
    const uploaded = values.photo instanceof File && values.photo.size > 0 ? values.photo : null
    const removePhoto = Boolean(values.remove_photo)
    const subject = String(values.subject ?? '').trim() || undefined

    let photoPatch: { avatarUrl?: string | null } = {}
    let newlyUploadedUrl: string | null = null

    if (uploaded) {
      if (!(await fitsSpec(uploaded, specAvatar))) {
        return fail(instruction({ code: 'profile.photo-spec' }))
      }
      const targetUid = subject ?? actorRes.value.id
      if (subject && subject !== actorRes.value.id) {
        const checkAccess = await u.profile(subject)
        if (!checkAccess.ok) return fail(instruction(checkAccess.fact))
        if (!checkAccess.value.canEdit) return fail(instruction({ code: 'auth.forbidden' }))
      }
      const saved = await saveManagedAvatar(targetUid, uploaded)
      if (!saved.ok) return fail(instruction(saved.fact))
      newlyUploadedUrl = saved.value.url
      photoPatch = { avatarUrl: newlyUploadedUrl }
    } else if (removePhoto) {
      photoPatch = { avatarUrl: null }
    }

    let r: Awaited<ReturnType<typeof u.updateProfile>>
    try {
      r = await u.updateProfile(
        {
          ...(nickname ? { nickname } : {}),
          ...photoPatch,
        },
        subject,
      )
    } catch (err) {
      if (newlyUploadedUrl) {
        await removeManagedAvatarByUrl(newlyUploadedUrl)
      }
      throw err
    }
    if (!r.ok) {
      if (newlyUploadedUrl) {
        await removeManagedAvatarByUrl(newlyUploadedUrl)
      }
      return fail(instruction(r.fact))
    }

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
