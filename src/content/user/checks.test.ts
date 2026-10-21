// Паритет проверок пользователя: клиент (AsyncRunner) и сервер
// (runAsyncChecks) с одним описанием и одним реестром от снимка конфига
// обязаны давать один вердикт — по никнейму сейчас, по фото с этапа R2,
// когда поле аватара станет photo.
import {
  AsyncRunner, decode, runAsyncChecks, validateForm, valuesForChecks,
} from '#lib/form/index.js'
import { formParams } from '#hooks/db-form.js'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_PHOTO_ID, PHOTO_RAW_MAX_BYTES, SERVER_PHOTO_FORMATS, avatarPhotoSpec, createUserChecks,
} from './checks.js'
import { defaults } from './config.js'
import { authForm } from './forms.js'
import { profile } from './schema.js'

const checks = createUserChecks(defaults)

describe('spec аватара: вход и выход разведены', () => {
  it('вход — серверное сырьё трёх форматов до 8 MiB, выход — JPEG из конфига', () => {
    const spec = avatarPhotoSpec(defaults)
    expect(spec.id).toBe(AVATAR_PHOTO_ID)
    expect(spec.input.formats).toEqual([...SERVER_PHOTO_FORMATS])
    expect(spec.input.maxBytes).toBe(PHOTO_RAW_MAX_BYTES)
    expect(spec.input.maxPixels).toBeGreaterThan(0)
    expect(spec.output).toEqual({
      format: 'image/jpeg', edge: defaults.avatarEdge, maxBytes: defaults.avatarMaxBytes,
    })
    expect(checks.has(`photo:${AVATAR_PHOTO_ID}`)).toBe(true)
    expect(checks.has('nickname-forbidden')).toBe(true)
  })
})

describe('никнейм: паритет AsyncRunner и runAsyncChecks на описании authForm', () => {
  const cases: readonly (readonly [string, string, string | null])[] = [
    ['обычный никнейм', 'Вася', null],
    ['пусто — менять нечего', '', null],
    ['служебное имя', 'admin', 'profile.nickname-forbidden'],
    ['служебное имя в другом регистре с пробелами', ' Root ', 'profile.nickname-forbidden'],
    ['похож, но не служебный целиком', 'administrator-x', null],
  ]

  for (const [title, nickname, code] of cases) {
    it(`${title}: вердикт один на обеих сторонах`, async () => {
      const data = new FormData()
      data.set('nickname', nickname)
      const values = valuesForChecks(data, authForm)
      const server = (await runAsyncChecks(authForm, values, checks))
        .filter((e) => e.path === 'nickname')
      const client = await new AsyncRunner(checks).run(authForm, 'nickname', values)
      expect(server.map((e) => e.code)).toEqual(code ? [code] : [])
      expect(client?.code ?? null).toBe(code)
    })
  }

  it('длина — из схемы профиля (2–32), синхронно на обеих сторонах', () => {
    const codesOf = (nickname: string) => {
      const data = new FormData()
      data.set('nickname', nickname)
      const { values } = decode(data, authForm)
      return validateForm(authForm, values, {})
        .filter((e) => e.path === 'nickname')
        .map((e) => e.code)
    }
    expect(codesOf('я')).toContain('minLength')
    expect(codesOf('x'.repeat(33))).toContain('maxLength')
    expect(codesOf('Вася')).toEqual([])
    expect(codesOf('')).toEqual([]) // пустой никнейм валиден: «не менять»
  })

  it('правила длины в описании равны правилам схемы профиля (formParams)', () => {
    // forms.ts держит числа литерально ради веса бандла — здесь сторожим,
    // что литералы не разошлись со схемой NICKNAME: вердикты обоих наборов
    // валидаторов обязаны совпадать на граничных длинах.
    const schemaCodes = (nickname: string) =>
      formParams(profile).nickname.validate
        .map((ref) => authForm.registry.validators.resolve(ref)(nickname, {} as never))
        .filter((x) => x !== null)
        .map((x) => x.code)
    const formCodes = (nickname: string) => {
      const data = new FormData()
      data.set('nickname', nickname)
      const { values } = decode(data, authForm)
      return validateForm(authForm, values, {})
        .filter((e) => e.path === 'nickname')
        .map((e) => e.code)
    }
    for (const len of [0, 1, 2, 32, 33]) {
      const nickname = 'x'.repeat(len)
      expect(formCodes(nickname), `длина ${len}`).toEqual(schemaCodes(nickname))
    }
  })
})
