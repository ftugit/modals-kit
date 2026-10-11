// Ход 12: события жизненного цикла — F35 (тождество с параметрами), F27 (повторный attach).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCore } from './build'
import { createModals } from './create'
import { memoryEngine } from './engine'
import { createRegistry } from './registry'
import { urlStorage } from './storages'

function setup(url = '/') {
  const log: string[] = []
  const scope = createRegistry('lifecycle').define([
    {
      name: 'a', component: 'a',
      onOpen: (c: any) => log.push(`open ${JSON.stringify(c.params)}`),
      onClose: (c: any) => log.push(`close ${JSON.stringify(c.params)}`),
    } as any,
  ])
  const core = buildCore(memoryEngine(url), urlStorage(), { lookup: scope.lookup })
  const m = createModals(core, { onHostOpen: () => log.push('host-open') } as any)
  return { m, log }
}

test('F35: замена a{id:1} на a{id:2} на той же позиции — close старой и open новой', () => {
  const { m, log } = setup()
  m.attach()
  m.open('a', { params: { id: 1 } })
  m.open('a', { params: { id: 2 }, stack: 'new' })
  assert.deepEqual(log.filter((l) => l !== 'host-open'), ['open {"id":1}', 'open {"id":2}', 'close {"id":1}'])
})

test('F35: смена только внешнего вида записи — не переоткрытие', () => {
  const { m, log } = setup()
  m.attach()
  m.open('a', { params: { id: 1 } })
  m.open('a', { params: { id: 1 }, color: '#000', stack: 'new' })
  assert.deepEqual(log.filter((l) => l !== 'host-open'), ['open {"id":1}'])
})

test('холодный старт по ссылке: onOpen и onHostOpen ровно один раз', () => {
  const { m, log } = setup('/?modal=a&modal.0.id=7')
  m.attach()
  assert.deepEqual(log, ['open {"id":7}', 'host-open'])
})

test('F27: повторное подключение не открывает заново живые записи', () => {
  const { m, log } = setup('/?modal=a&modal.0.id=7')
  const detach = m.attach()
  detach()
  m.attach()
  m.attach()
  assert.deepEqual(log, ['open {"id":7}', 'host-open'])
})
