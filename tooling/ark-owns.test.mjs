import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ARK_RULES, formatFindings, scanSource } from './ark-owns.mjs'

/* ── правила ловят то, что должны ──────────────────────────────────── */

test('ловит ручной возврат фокуса', () => {
  const f = scanSource('let preOpenEl = null\npreOpenEl.focus({ preventScroll: true })')
  assert.ok(f.some((x) => x.id === 'restore-focus'))
})

test('ловит ручной scroll-lock', () => {
  const f = scanSource("document.body.style.overflow = 'hidden'")
  assert.ok(f.some((x) => x.id === 'scroll-lock'))
})

test('ловит самодельную ловушку фокуса', () => {
  const f = scanSource("if (event.key === 'Tab') { trap(event) }")
  assert.ok(f.some((x) => x.id === 'focus-trap'))
})

test('ловит эвристику focusin вместо persistentElements', () => {
  const f = scanSource("if (event.type === 'focusin') return")
  const hit = f.find((x) => x.id === 'focusin-heuristic')
  assert.ok(hit)
  assert.match(hit.prop, /persistentElements/)
})

test('ловит ручной aria-hidden и ручную роль диалога', () => {
  assert.ok(scanSource("el.setAttribute('aria-hidden', 'true')").some((x) => x.id === 'hide-outside'))
  assert.ok(scanSource('<div role="dialog">').some((x) => x.id === 'dialog-role'))
})

/* ── и НЕ ловят то, что не должны ──────────────────────────────────── */

test('комментарии не считаются кодом', () => {
  assert.deepEqual(scanSource("// preOpenEl больше не нужен — есть restoreFocus"), [])
  assert.deepEqual(scanSource('/*\n * preOpenEl: историческая справка\n */'), [])
  assert.deepEqual(scanSource(' * document.body.style.overflow = hidden'), [])
})

test('осознанное отклонение отключается по месту', () => {
  const src = "preOpenEl.focus() // ark-owns-ok: возврат в конкретный слой стопки"
  assert.deepEqual(scanSource(src), [])
})

test('обычный код не задевается', () => {
  const src = [
    "import { Dialog } from '@ark-ui/svelte/dialog'",
    'const open = chain.length > 0',
    "el.setAttribute('data-anchor', anchor)",
    'input.focus()',
  ].join('\n')
  assert.deepEqual(scanSource(src), [])
})

test('отчёт называет замену и способ отключения', () => {
  const f = scanSource("let preOpenEl = null")
  const report = formatFindings('host.svelte', f)
  assert.match(report, /restoreFocus/)
  assert.match(report, /ark-owns-ok/)
  assert.match(report, /host\.svelte:1/)
})

test('у каждого правила есть проп и объяснение', () => {
  for (const r of ARK_RULES) {
    assert.ok(r.id && r.pattern instanceof RegExp, `${r.id}: нет id/паттерна`)
    assert.ok(r.prop, `${r.id}: не назван проп Ark`)
    assert.ok(r.why && r.why.length > 30, `${r.id}: объяснение слишком куцее`)
  }
})

/* ── боевой прогон по реальному исходнику ──────────────────────────── */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\./.test(name)) acc.push(p)
  }
  return acc
}

test('src/lib/modals не содержит того, что должен брать Ark', () => {
  const files = walk('src/lib/modals')
  assert.ok(files.length > 0, 'нечего проверять — путь изменился?')
  const problems = []
  for (const file of files) {
    const findings = scanSource(readFileSync(file, 'utf8'))
    if (findings.length) problems.push(formatFindings(file, findings))
  }
  assert.equal(problems.length, 0, problems.join('\n'))
})
