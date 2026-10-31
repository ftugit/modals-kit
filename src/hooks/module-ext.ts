import type { Resource } from '#lib/db/index.js'

// SQL-шаг инициализации или миграции модуля для `defineSchema`.
export interface DbModuleSqlStep {
  readonly id: string
  readonly text: string
}

// Расширение схемы базы данных от установленного модуля (db.ext.ts в папке модуля).
export interface DbModuleExtension {
  readonly resources?: readonly Resource[]
  readonly sql?: readonly DbModuleSqlStep[]
}

// Пункт навигации модуля (структурно совместим с NavItem оболочки).
export interface ModuleNavItem {
  readonly to: string
  readonly label: string
}

// Карточка модуля на стартовой странице (`/`).
export interface ModuleHomeCard {
  readonly href: string
  readonly title: string
  readonly text: string
  readonly ctaLabel?: string
  readonly devHref?: string
  readonly devLabel?: string
}

// Расширение меню и главной страницы от установленного модуля (nav.ext.ts в папке модуля).
export interface NavModuleExtension {
  readonly order?: number
  readonly navItems?: readonly ModuleNavItem[]
  readonly homeCards?: readonly ModuleHomeCard[]
}
