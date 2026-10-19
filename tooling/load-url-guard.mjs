/**
 * Гейт «event.url, а не event.request.url» в серверных load'ах (ход 261).
 *
 * Зачем: только accessor `event.url` объявляет зависимость load от поиска адреса;
 * `event.request.url` — снимок Request, load при смене `?параметра=` НЕ перезапускается,
 * и клиент видит мёртвый шаг (реальный баг `/user/auth?step=register`: SPA показывал
 * пустую форму регистрации, seed не приходил). В экшенах `request.url` корректен —
 * у них зависимостей не бывает, поэтому правило проверяет ТОЛЬКО тела
 * `export const load` / `export const layout` в `*.server.ts`.
 *
 * Как действовать при срабатывании: заменить в теле load на `event.url`.
 * Если нужен полный адрес как строка — `event.url.href`.
 *
 * Плагином в build не делаем: проверка дешёвая, гоняется `node --test tooling/`
 * вместе с остальными гейтами tooling.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOAD_RE =
  /export\s+const\s+(load|layout)\b\s*(?::[^=]+)?=\s*async\s*\(([^)]*)\)\s*=>\s*\{/

/**
 * Убрать комментарии (строчные и блочные), строки не трогать: правило ищет
 * ВЫЗОВ, а упоминание ловушки в комментарии — не нарушение.
 * @param {string} body
 */
export function stripComments(body) {
  let out = ''
  let q = null
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    const prev = body[i - 1]
    if (q) {
      if (q === '//' && c === '\n') { q = null; out += c }
      else if (q === '/*' && c === '/' && prev === '*') { q = null; out += ' ' }
      else if (q === '/*') { if (c === '\n') out += c }
      else if (q === c && prev !== '\\') { q = null; out += c }
      else if (q !== '//' && q !== '/*') out += c
      continue
    }
    if (c === '/' && (body[i + 1] === '/' || body[i + 1] === '*')) {
      q = body[i + 1] === '/' ? '//' : '/*'
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') q = c
    out += c
  }
  return out
}

/**
 * Тела серверных load'ов файла: имя функции, параметр события, тело с позиции.
 * Скобочный баланс с учётом строк ('"`), шаблонов и комментариев — чтобы тело
 * не оборвалось на фигурных скобках в литералах.
 * @param {string} source
 * @returns {{ name: string, event: string, body: string }[]}
 */
export function loadBodies(source) {
  const out = []
  let m
  const re = new RegExp(LOAD_RE.source, 'g')
  while ((m = re.exec(source))) {
    // m[0] заканчивается открывающей `{` — matchBlock ждёт позицию НА ней
    const start = m.index + m[0].length - 1
    const body = matchBlock(source, start)
    out.push({ name: m[1], event: m[2].trim().split(/[,:]/)[0].trim(), body })
  }
  return out
}

/** Тело блока от открывающей `{` (позиция — НА ней) до парной скобки. */
function matchBlock(source, start) {
  let depth = 0
  let q = null // активная строка: ' " ` или // /* (обрезаем по предку)
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    const prev = source[i - 1]
    if (q) {
      if (q === '//' && c === '\n') q = null
      else if (q === '/*' && c === '/' && prev === '*') q = null
      else if (q === c && prev !== '\\') q = null
      continue
    }
    if (c === "'" || c === '"' || c === '`' || c === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      q = c === '/' ? (source[i + 1] === '/' ? '//' : '/*') : c
      if (q === '/*' || q === '//') i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

/**
 * Нарушения в одном файле: `«событие».request.url` внутри тела load.
 * @param {string} source
 * @param {string} [file] — для сообщений
 * @returns {string[]}
 */
export function checkSource(source, file = 'файл') {
  const problems = []
  for (const { name, event, body } of loadBodies(source)) {
    if (!event) continue
    const needle = `${event}.request.url`
    if (stripComments(body).includes(needle)) {
      problems.push(
        `${file}: ${name}() читает ${needle} — load не перезапустится при смене поиска адреса ` +
          `(клиент получит мёртвый шаг). Используйте ${event}.url: только accessor объявляет ` +
          'зависимость load. Полный адрес строкой — ' + event + '.url.href',
      )
    }
  }
  return problems
}

/** Обойти каталог routes и собрать нарушения по всем *.server.ts. */
export function checkDir(root) {
  const problems = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.server.ts') && (name.startsWith('+page') || name.startsWith('+layout'))) {
        problems.push(...checkSource(readFileSync(path, 'utf8'), path))
      }
    }
  }
  walk(root)
  return problems
}

if (process.argv[1] && process.argv[1].endsWith('load-url-guard.mjs')) {
  const root = process.argv[2] ?? new URL('../src/routes', import.meta.url).pathname
  const problems = checkDir(root)
  if (problems.length) {
    for (const p of problems) console.error(p)
    process.exit(1)
  }
  console.log('load-гейты соблюдены: event.request.url в load не встречается')
}
