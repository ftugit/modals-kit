import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserFailureLines } from './browser-output.mjs'

test('сохраняет маркированные ошибки и контекст конца вывода', () => {
  assert.deepEqual(browserFailureLines('FAIL earlier\nok later\n❌ timeout\n', 2), [
    'FAIL earlier', 'ok later', '❌ timeout',
  ])
})

test('если маркеров нет, показывает хвост исключения', () => {
  assert.deepEqual(browserFailureLines('started\nError: timeout\n    at check (file.js:12)\n', 2), [
    'Error: timeout', 'at check (file.js:12)',
  ])
})
