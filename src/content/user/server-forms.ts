// Серверная регистрация встраиваемых форм модуля пользователя (`ProfileForm`).
// Импортируется один раз в `src/hooks.server.ts`: теперь `<ProfileForm />`
// поднимает свой POST на любом роуте приложения (`/user/profile`, модалка,
// любая пользовательская страница) и возвращает на ту же страницу.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#lib/server/component-forms.js'
import { auth, vaultPayloadOf } from './gateway.js'
import { profileForm } from './forms.js'
import { instruction } from './index.js'

registerComponentForm({
  description: profileForm,
  execute: async ({ values, intent, commit, fail, request }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'profile') return fail(instruction({ code: 'auth.confirm' }))

    const nickname = String(values.nickname ?? '').trim()
    const avatar = String(values.avatar ?? '')
    const r = await u.updateProfile({
      ...(nickname ? { nickname } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
    })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    // Перевыпускаем куки сессии со свежим снимком ника/аватара, чтобы SSR и
    // клиентский vault сразу видели обновлённый профиль на любой странице.
    let user: unknown
    try {
      const renewed = await u.renew()
      if (renewed.ok) user = await vaultPayloadOf(renewed.value)
    } catch {
      /* профиль уже записан; обновится при штатном продлении */
    }
    void request
    return { data: { step: 'done', ...(user ? { user } : {}) } }
  },
  redirectOnSuccess: (event) => localPath(event.url.searchParams.get('next')),
})
