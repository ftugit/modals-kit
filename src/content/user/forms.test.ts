// Контракт «пустая отправка» — защита от регресса хода 258: после появления
// `v.required()` на seed экшены logout/challenge/renew/accept падали на
// seed.required ЕЩЁ ДО execute — сервисные действия конверт-онли, поля им не
// нужны, а relax стоял только у restore/profile. Баг молчал до хода 261:
// сервер отвечал 422 валидной на вид ошибкой поля, тест «выход» проходил
// впустую (шаг и так был entry). Правило здесь: экшен с `validate != 'full'`
// обязан проходить ПУСТУЮ отправку без ошибок валидации — именно так его
// разобрал бы движок при конверт-онли походе.
// Новая форма модуля — добавь в СПИСОК ниже; новая не-full форма в другом
// модуле — скопируй тест к её описанию.
import { decode, validateForm, type FormDescription } from '#lib/form/index.js'
import { describe, expect, test } from 'vitest'
import { authForm, profileForm } from './forms.js'

const FORMS: readonly FormDescription[] = [authForm, profileForm]

describe('контракт форм: не-full экшен проходит пустую отправку', () => {
  for (const desc of FORMS) {
    test(`${desc.id}: каждый validate != 'full' без ошибок на пустом FormData`, () => {
      // пустая отправка: ни одного поля формы, только конверт (его валидацию
      // тут не проверяем — она отдельная); decode даёт пустые значения типов
      const { values } = decode(new FormData(), desc)
      for (const action of desc.actions) {
        if (action.validate === 'full') continue
        const errors = validateForm(desc, values, { relax: action.relax, subset: action.subset })
        const codes = errors.map((e) => `${e.path}:${e.code}`).join(', ')
        expect(
          codes,
          `экшен «${action.id}» (validate: '${action.validate}') падает на пустой отправке: ${codes}. ` +
            'Сервисному действию поля не нужны: добавь экшену relax: [\'required\'] ' +
            '(как у сервисных действий authForm) или ограничь проверку subset; иначе ЛЮБОЙ поход ' +
            'этим интентом отклоняется до execute — молча для пользователя.',
        ).toBe('')
      }
    })
  }
})
