// Серверный POST-обработчик компонента `ProfileForm` (`#hooks/component-form`).
//
// Готовый сжатый кадр сохраняется в боевое хранилище приложения (`saveManagedAvatar`)
// под уникальным неизменяемым путём `avatars/<uid>/<hash>-<nonce>.<ext>`, а в БД
// профиля и куку `auth_tmp` ложится короткая ссылка `/api/storage/avatars/…`.
// При замене или снятии фото прежний файл физически удаляется сразу (`storage.remove`).
import { fitsSpec } from './spec-fit.js'
import { removeManagedAvatarByUrl, saveManagedAvatar } from '#server/app-storage.server.js'
import { localStore } from '#server/cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { createUserChecks } from '../../checks.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { createUserConfig, instruction } from '../../index.js'
import { userAuthRoute } from '../../routes.js'
import { specAvatar } from '../../spec-avatar.js'
import { profileForm } from './form.js'

const userConfig = createUserConfig(localStore.scope('user-config'))

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
      return fail(instruction({ code: 'profile.photo-format' }))
    }

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
      // Проверяем сессию и право редактирования ДО записи байтов в хранилище.
      const actorRes = await u.actor()
      if (!actorRes.ok) return fail(instruction(actorRes.fact))
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
