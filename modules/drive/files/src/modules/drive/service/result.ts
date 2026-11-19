/**
 * Форма результата сервисов «Диска».
 *
 * Ошибка — код домена (`messages.ts`), а не исключение: маршрут и модалка
 * решают, что показать, и не разбирают текст ошибки. Исключения остаются для
 * настоящих сбоев (нет БД, упал драйвер).
 */
import type { DriveResult } from '../types.js'

export function driveOk<T>(value: T): DriveResult<T> {
  return { ok: true, value }
}

export function driveFail<T = never>(
  code: string,
  params?: Record<string, unknown>,
): DriveResult<T> {
  return { ok: false, code, ...(params ? { params } : {}) }
}
