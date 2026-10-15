import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TaskState } from '#lib/task/index.js'
import { paginatorTask } from './task'

const loading = (page: number) => ({ status: 'loading' as const, pending: { page, mode: 'replace' as const, count: 10 } })

describe('paginatorTask', () => {
  it('покой и ошибка — idle', () => {
    expect(paginatorTask({ status: 'idle', pending: null }).status).toBe('idle')
    expect(paginatorTask({ status: 'error', pending: null }).status).toBe('idle')
  })
  it('без page — любая загрузка', () => {
    expect(paginatorTask(loading(3))).toEqual({ status: 'pending', scope: 'local' })
  })
  it('с page — только эта страница', () => {
    expect(paginatorTask(loading(3), 3).status).toBe('pending')
    expect(paginatorTask(loading(3), 4).status).toBe('idle')
  })
  it('совместим с TaskState без зависимости от #lib/task', () => {
    expectTypeOf(paginatorTask).returns.toExtend<TaskState>()
  })
})
