// Контракт «пустая отправка»: каждый экшен с `validate != 'full'` обязан
// проходить пустую отправку без ошибок валидации полей, чтобы конверт-онли
// сервисные действия (`logout`, `challenge`, `renew`, `accept`) никогда не
// отклонялись движком форм до `execute`.
import { decode, validateForm, type FormDescription } from '#lib/form/index.js'
import { describe, expect, test } from 'vitest'
import { profileForm } from './profile-form/form.js'
import { seedForm } from './seed-form/form.js'

const FORMS: readonly FormDescription[] = [seedForm, profileForm]

describe('контракт форм: не-full экшен проходит пустую отправку', () => {
  for (const desc of FORMS) {
    test(`${desc.id}: каждый validate != 'full' без ошибок на пустом FormData`, () => {
      const { values } = decode(new FormData(), desc)
      for (const action of desc.actions) {
        if (action.validate === 'full') continue
        const errors = validateForm(desc, values, { relax: action.relax, subset: action.subset })
        const codes = errors.map((e) => `${e.path}:${e.code}`).join(', ')
        expect(
          codes,
          `экшен «${action.id}» (validate: '${action.validate}') падает на пустой отправке: ${codes}.`,
        ).toBe('')
      }
    })
  }
})
