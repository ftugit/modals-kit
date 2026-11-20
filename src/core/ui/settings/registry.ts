/**
 * Реестр пунктов настроек: плоский список, который наполняют модули.
 *
 * Второго уровня здесь нет: если пункту нужны свои табы, форма или список,
 * он рисует их сам. Модуль решает и сам факт пункта — через `visible` и
 * `ownOnly`; нет прав или показывать нечего — пункта нет.
 */
import type { Component } from 'svelte'

export interface SettingsContext {
  /** `null` — свои настройки, строка — чужой пользователь. */
  readonly uid: string | null
  readonly surface: 'page' | 'modal'
  readonly stepsMode: 'url' | 'local' | 'hybrid'
  readonly isOwn: boolean
  readonly canRead: boolean
  readonly canEdit: boolean
}

export interface SettingsSectionProps<Screen = unknown> {
  readonly ctx: SettingsContext
  /** Экранные пропсы носителя: хост передаёт их секции. */
  readonly screen: Screen
}

export interface SettingsSection<Screen = unknown> {
  /** Стабильный id: он же ключ адреса и `data-testid`. Имя назначает модуль. */
  readonly id: string
  readonly label: string
  readonly order?: number
  readonly component: Component<SettingsSectionProps<Screen>>
  /** Пункт виден, только если вернёт `true`. Права проверяются здесь. */
  readonly visible?: (ctx: SettingsContext) => boolean
  /** Сахар для частого случая: пункт только для своих настроек. */
  readonly ownOnly?: boolean
}

const sections: SettingsSection[] = []

export function registerSettingsSection<Screen>(section: SettingsSection<Screen>): void {
  if (sections.some((entry) => entry.id === section.id)) return
  sections.push(section as SettingsSection)
}

export function settingsSectionsFor<Screen = unknown>(ctx: SettingsContext): SettingsSection<Screen>[] {
  if (!ctx.canRead) return []
  return (sections as SettingsSection<Screen>[])
    .filter((entry) => !entry.ownOnly || ctx.isOwn)
    .filter((entry) => entry.visible?.(ctx) ?? true)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/** Только для тестов: очистить реестр между кейсами. */
export function resetSettingsSections(): void {
  sections.length = 0
}
