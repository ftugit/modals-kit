import { describe, expect, it } from 'vitest'
import { IDLE_TASK, taskLabel, taskPercent, type TaskState } from './index'

const pending = (progress?: Extract<TaskState, { status: 'pending' }>['progress'], label?: string): TaskState => ({
  status: 'pending',
  scope: 'local',
  ...(label ? { label } : {}),
  ...(progress ? { progress } : {}),
})

describe('taskPercent', () => {
  it('нет задачи или хода — числа нет', () => {
    expect(taskPercent(IDLE_TASK)).toBeNull()
    expect(taskPercent(undefined)).toBeNull()
    expect(taskPercent(pending())).toBeNull()
    expect(taskPercent({ status: 'error', message: 'x' })).toBeNull()
  })

  it('байты — честный процент, целый, в пределах 0–100', () => {
    expect(taskPercent(pending({ kind: 'bytes', loaded: 43, total: 100 }))).toBe(43)
    expect(taskPercent(pending({ kind: 'bytes', loaded: 999, total: 100 }))).toBe(100)
    expect(taskPercent(pending({ kind: 'bytes', loaded: 1, total: 3 }))).toBe(33)
  })

  it('шаги — доля завершённых этапов (10 этапов → по 10%)', () => {
    expect(taskPercent(pending({ kind: 'steps', done: 3, total: 10 }))).toBe(30)
    expect(taskPercent(pending({ kind: 'steps', done: 4, total: 4 }))).toBe(100)
  })

  it('неизвестный или нулевой total — числа нет, а не NaN/Infinity', () => {
    expect(taskPercent(pending({ kind: 'bytes', loaded: 10, total: 0 }))).toBeNull()
    expect(taskPercent(pending({ kind: 'bytes', loaded: 10, total: Number.NaN }))).toBeNull()
  })
})

describe('taskLabel', () => {
  it('шаги называют текущий этап', () => {
    expect(taskLabel(pending({ kind: 'steps', done: 1, total: 4, step: 'проверка схемы' }, 'Запуск базы'))).toBe(
      'Запуск базы — шаг 2 из 4: проверка схемы',
    )
  })
  it('байты — процент, ошибка — её текст, покой — ничего', () => {
    expect(taskLabel(pending({ kind: 'bytes', loaded: 1, total: 2 }, 'Загрузка'))).toBe('Загрузка — 50%')
    expect(taskLabel({ status: 'error', message: 'нет сети' })).toBe('нет сети')
    expect(taskLabel(IDLE_TASK)).toBeUndefined()
  })
})
