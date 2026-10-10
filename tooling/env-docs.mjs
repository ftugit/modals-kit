/**
 * env-docs — страж `.env.example`.
 *
 * Переменные окружения ломаются тише всего: код начинает читать новый ключ,
 * example-файл молчит, и первый же деплой упирается в 403 или в «курсор выключен»,
 * а имя ключа приходится искать по исходникам (именно так и произошло с
 * `origin.rejected`: код названия не говорил).
 *
 * Поэтому правило простое: каждое имя, которое читает серверный код приложения,
 * обязано быть названо в `.env.example` — как строка `КЛЮЧ=` (то, что настраивает
 * человек) или как упоминание (то, что ставит платформа). Проверяется обоими
 * способами, потому что «упомянуть» переменную хостера отдельной строкой настройки
 * было бы вызовом задать её руками.
 */

/** Каталоги, чьё чтение окружения считается контрактом для разработчика. */
export const SCANNED_DIRS = ['src/lib/server', 'src/routes', 'src/lib/db/sveltekit']

/**
 * Отдельные файлы сборки: они читают окружение ДО появления серверного кода, и их
 * ключи нужны в примере особенно — их задают в секции Build, а не Runtime.
 */
export const SCANNED_FILES = ['svelte.config.js', 'vite.config.ts']

/** Расширения файлов, в которых ищем чтение env. */
export const SCANNED_EXT = ['.ts', '.js', '.svelte']

/**
 * Имена, которые подставляет Vite/SvelteKit: пользователем не настраиваются, поэтому
 * остаются необязательными в примере, иначе example превратится в список того, что
 * всё равно нельзя задать.
 */
export const RUNTIME_INJECTED = new Set(['DEV', 'PROD', 'SSR', 'NODE_ENV', 'MODE', 'BASE_URL'])

/**
 * Имена, которые предоставляет платформа (Vercel, песочница превью). Требование к
 * ним мягче: ключ обязан быть упомянут в файле (чтобы читатель понял, откуда он
 * берётся), но строкой `КЛЮЧ=` не обязан — ставить их руками вредно.
 */
export const HOST_SET_NAMES = new Set(['VERCEL', 'E2B_SANDBOX_ID'])

/** Собирает имена переменных, которые текст читает из окружения. */
export function collectEnvNames(text) {
  const out = new Set()
  const keep = (name) => {
    if (!name) return
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return
    if (RUNTIME_INJECTED.has(name)) return
    out.add(name)
  }
  // env('KEY') / env("KEY") — канон серверного слоя (`envReader`)
  for (const m of text.matchAll(/\benv\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)) keep(m[1])
  // process.env.KEY и import.meta.env.KEY
  for (const m of text.matchAll(/(?:process|import\.meta)\.env\.([A-Z0-9_]+)/g)) keep(m[1])
  // деструктуризация: `const { DB_POOL_MAX, X } = process.env`
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*(?:env|process\.env)\b/g)) {
    for (const part of m[1].split(',')) keep(part.trim().split(/\s*:\s*/).pop().split('=')[0].trim())
  }
  return [...out].sort()
}

/** Ключи, которые example объявляет как настраиваемые: строки `КЛЮЧ=` (комментарий не считается). */
export function documentedKeys(text) {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]).sort()
}

/**
 * @param {{ sources: Record<string,string>, example: string }} input
 * @returns {string[]} проблемы; пусто — контракт выполнен
 */
export function auditEnvDocs({ sources, example }) {
  const problems = []
  const keys = new Set(documentedKeys(example))
  const used = new Set()

  for (const [file, text] of Object.entries(sources)) {
    for (const name of collectEnvNames(text)) {
      used.add(name)
      if (keys.has(name)) continue
      // хостер-переменная: достаточно честного упоминания в файле
      if (HOST_SET_NAMES.has(name) && new RegExp(`\\b${name}\\b`).test(example)) continue
      problems.push(`${file}: читает «${name}», в .env.example ключ не объявлен`)
    }
  }

  // обратная сторона: объявленный, но не читаемый ключ = устаревшая документация
  const allNames = new Set(used)
  for (const key of keys) {
    if (!allNames.has(key)) problems.push(`.env.example: объявлен «${key}», но серверный код его не читает`)
  }
  return problems
}

/** Человекочитаемый вывод для теста и для `node tooling/env-docs.mjs`. */
export function formatProblems(problems) {
  return problems.length ? problems.map((p) => `  ✗ ${p}`).join('\n') : '  ✓ все ключи на месте'
}
