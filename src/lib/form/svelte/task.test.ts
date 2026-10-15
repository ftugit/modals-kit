import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TaskState } from '#lib/task/index.js'
import { initialState, type FormState } from '../state'
import { formTask } from './task'

const sending = (intent: string): FormState => ({ ...initialState(1 as never), status: 'submitting', pending: true, pendingIntent: intent })

describe('formTask', () => {
  it('покой — idle', () => {
    expect(formTask(initialState(1 as never)).status).toBe('idle')
  })
  it('отправка — pending local без подписи (слова выбирает UI)', () => {
    expect(formTask(sending('submit'))).toEqual({ status: 'pending', scope: 'local' })
  })
  it('с intent — только у нажатого действия', () => {
    expect(formTask(sending('save-draft'), 'save-draft').status).toBe('pending')
    expect(formTask(sending('save-draft'), 'submit').status).toBe('idle')
  })
  it('ход от транспорта в формате задачи — как есть; чужой вид — без подробностей', () => {
    const progress = { status: 'pending', scope: 'global', label: 'Запуск базы', progress: { kind: 'steps', done: 2, total: 4 } }
    expect(formTask({ ...sending('submit'), progress })).toBe(progress)
    expect(formTask({ ...sending('submit'), progress: 'x' })).toEqual({ status: 'pending', scope: 'local' })
  })
  it('совместим с TaskState без зависимости от #lib/task', () => {
    expectTypeOf(formTask).returns.toExtend<TaskState>()
  })
  it('ошибка отправки — не ошибка кнопки', () => {
    expect(formTask({ ...initialState(1 as never), status: 'error' }).status).toBe('idle')
  })
})
