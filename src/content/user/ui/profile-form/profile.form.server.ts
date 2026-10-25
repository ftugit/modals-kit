// Серверный POST-обработчик компонента `ProfileForm` (`#hooks/component-form`).
//
// Картинка НЕ конвертируется: прийти должен уже приведённый кадр — его готовит
// браузерный примитив (`photoConvert={specAvatar}`). Соответствие спеке судит
// проверка `avatar-spec` в описании формы; здесь она повторяется перед записью,
// чтобы непроверенный файл не мог попасть в профиль. Приведение «на сервере для
// тех, кто без JS» — задача очереди, см. `docs/plan-queue.md`.
import { fitsSpec } from './spec-fit.js'
import { localStore } from '#server/cache.server.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { createUserChecks } from '../../checks.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { createUserConfig, instruction } from '../../index.js'
import { userAuthRoute } from '../../routes.js'
import { specAvatar } from '../../spec-avatar.js'
import { profileForm } from './form.js'

const userConfig = createUserConfig(localStore.scope('user-config'))

/** Готовый файл → `data:image/jpeg;base64,…` (текущий способ хранения профиля). */
async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type};base64,${btoa(binary)}`
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
      return fail(instruction({ code: 'profile.photo-format' }))
    }

    const nickname = String(values.nickname ?? '').trim()
    const uploaded = values.photo instanceof File && values.photo.size > 0 ? values.photo : null
    const removePhoto = Boolean(values.remove_photo)

    let photoPatch: { avatarUrl?: string | null } = {}
    if (uploaded) {
      // Сервер не приводит картинку: сохраняем только то, что уже совпало со
      // спекой. Проверка повторена здесь, а не только в `avatar-spec`: запись
      // не должна зависеть от того, что реестр проверок подключён к форме.
      if (!(await fitsSpec(uploaded, specAvatar))) return fail(instruction({ code: 'profile.photo-spec' }))
      photoPatch = { avatarUrl: await toDataUrl(uploaded) }
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
