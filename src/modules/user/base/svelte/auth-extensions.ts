/**
 * Реестр шагов входа, которые поставляет субмодуль.
 *
 * `AuthWidget` не импортирует компоненты профиля или других доменов: он
 * рендерит зарегистрированный шаг, а регистрация приходит из `auth.ext.ts`
 * субмодуля (её подхватывает glob в layout). Нет субмодуля — нет шага:
 * вход завершается сразу после базовых шагов.
 */
import type { Component } from 'svelte'

/** Пропсы, которые базовый виджет передаёт шагу расширения. */
export interface AuthStepProps {
  limits?: unknown
  authorized?: boolean
  enabled?: boolean
  doneHref?: string
  onDone?: () => void
  variant?: import('./Acl.svelte').UserSurfaceVariant
  class?: string
}

export interface AuthStep {
  /** Стабильный ключ шага (`profile`). */
  id: string
  component: Component<AuthStepProps>
  /** Умолчания формы/лимитов, которые домен знает лучше базового слоя. */
  defaultLimits?: Record<string, unknown>
}

const steps: AuthStep[] = []

/** Идемпотентно: повторный импорт модуля не плодит шаг. */
export function registerAuthStep(step: AuthStep): void {
  if (steps.some((s) => s.id === step.id)) return
  steps.push(step)
}

export function authSteps(): readonly AuthStep[] {
  return steps
}

export function authStepOf(id: string): AuthStep | undefined {
  return steps.find((s) => s.id === id)
}
