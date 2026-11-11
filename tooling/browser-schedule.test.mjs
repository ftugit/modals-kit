import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBrowserSchedule } from './browser-schedule.mjs'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('exclusive suite does not overlap, other suites retain bounded parallelism and indices', async () => {
  const names = ['a', 'b', 'regressions', 'c', 'd']
  const running = new Set()
  const seen = []
  let max = 0
  await runBrowserSchedule(names, 2, async (name, index) => {
    if (name === 'regressions') assert.equal(running.size, 0)
    else assert.equal(running.has('regressions'), false)
    running.add(name)
    max = Math.max(max, running.size)
    seen.push([name, index])
    await delay(10)
    running.delete(name)
  }, (name) => name === 'regressions')
  assert.equal(max, 2)
  assert.deepEqual(seen, names.map((name, index) => [name, index]))
  assert.equal(running.size, 0)
})

test('empty and single-suite lists run without unintended work', async () => {
  const seen = []
  await runBrowserSchedule([], 2, (n) => seen.push(n), () => true)
  await runBrowserSchedule(['regressions'], 2, (n) => seen.push(n), () => true)
  assert.deepEqual(seen, ['regressions'])
})
