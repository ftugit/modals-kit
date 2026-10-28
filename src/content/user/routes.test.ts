// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { parseAuthStage } from './routes.js'

describe('parseAuthStage: адрес шагов и плоские значения', () => {
  test('полный ключ цепочки шагов (`auth.register`) — та же стадия', () => {
    // Хост шагов пишет в `?stage` полный ключ (`auth` + аддон formSteps);
    // серверный рендер и no-JS обязаны открывать именно эту стадию.
    expect(parseAuthStage('auth.register')).toBe('register')
    expect(parseAuthStage('auth.restore')).toBe('restore')
    expect(parseAuthStage('auth.entry')).toBe('entry')
  })

  test('плоские значения и стадии хоста — как раньше', () => {
    expect(parseAuthStage('register')).toBe('register')
    expect(parseAuthStage('profile')).toBe('profile')
    expect(parseAuthStage('blocked')).toBe('blocked')
    expect(parseAuthStage('restrictions')).toBe('restrictions')
  })

  test('мусор и пустота — entry', () => {
    expect(parseAuthStage('auth.banana')).toBe('entry')
    expect(parseAuthStage('banana')).toBe('entry')
    expect(parseAuthStage('')).toBe('entry')
    expect(parseAuthStage(undefined)).toBe('entry')
    expect(parseAuthStage(null)).toBe('entry')
  })
})
