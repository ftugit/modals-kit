/**
 * Реестр встроенных шагов настроек (`UserConfig`).
 *
 * Шаг «Сессии» — часть субмодуля `user/sessions`: базовые настройки не
 * импортируют список сессий, а рендерят зарегистрированный компонент.
 */
import type { Component } from 'svelte'
import type { Snippet } from 'svelte'

export interface ConfigStepProps {
  uid?: string | null
  context?: 'page' | 'modal'
  frame?: (parts: { header: Snippet; body: Snippet }) => unknown
  onAcl?: (fact: string) => void
  class?: string
}

export interface ConfigStep {
  id: string
  component: Component<ConfigStepProps>
}

const steps: ConfigStep[] = []

export function registerConfigStep(step: ConfigStep): void {
  if (steps.some((s) => s.id === step.id)) return
  steps.push(step)
}

export function configStepOf(id: string): ConfigStep | undefined {
  return steps.find((s) => s.id === id)
}
