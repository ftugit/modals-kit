import { describe, expect, it } from 'vitest'
import { normalizeSubjects, resolveSeedSubjects } from './subjects.js'

const SELF = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

describe('набор целей формы блокировки', () => {
  it('своя цель остаётся в наборе: клиент не вычитает себя молча', () => {
    expect(normalizeSubjects([SELF, OTHER])).toEqual([SELF, OTHER])
  })

  it('убирает пустые части и повторы, сохраняя порядок', () => {
    expect(normalizeSubjects([` ${SELF} , ${OTHER} `, ' , ', SELF, ''])).toEqual([SELF, OTHER])
  })

  it('явный список важнее одиночной цели, одиночная цель важнее среза', () => {
    expect(resolveSeedSubjects([SELF], OTHER, OTHER)).toEqual([SELF])
    expect(resolveSeedSubjects(undefined, OTHER, SELF)).toEqual([OTHER])
    expect(resolveSeedSubjects([], '', SELF)).toEqual([SELF])
  })

  it('пустые источники дают пустой набор', () => {
    expect(resolveSeedSubjects(undefined, '', null)).toEqual([])
    expect(resolveSeedSubjects([], '   ', undefined)).toEqual([])
  })

  it('негативный контроль: вычитание своей цели ломает набор', () => {
    // Мутация «как было»: исключить себя. Тест обязан упасть на такой реализации.
    const subtractSelf = (raw: readonly string[], selfId: string) =>
      // target-rule-ok: это и есть негативный контроль, а не боевой код
      normalizeSubjects(raw).filter((id) => id !== selfId)
    expect(subtractSelf([SELF, OTHER], SELF)).not.toEqual([SELF, OTHER])
  })
})
