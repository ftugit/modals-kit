import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerSettingsSection,
  resetSettingsSections,
  settingsSectionsFor,
  type SettingsContext,
  type SettingsSection,
} from './registry.js'

const ctx = (patch: Partial<SettingsContext> = {}): SettingsContext => ({
  uid: null,
  surface: 'page',
  stepsMode: 'url',
  isOwn: true,
  canRead: true,
  canEdit: true,
  ...patch,
})

const section = (id: string, patch: Partial<SettingsSection> = {}): SettingsSection => ({
  id,
  label: id,
  component: (() => {}) as never,
  ...patch,
})

beforeEach(() => resetSettingsSections())

describe('settings registry', () => {
  it('сортирует по order и не дублирует id', () => {
    registerSettingsSection(section('drive', { order: 30 }))
    registerSettingsSection(section('account', { order: 10 }))
    registerSettingsSection(section('account', { order: 5 }))
    expect(settingsSectionsFor(ctx()).map((s) => s.id)).toEqual(['account', 'drive'])
  })

  it('ownOnly отсекает чужой uid', () => {
    registerSettingsSection(section('drive', { ownOnly: true }))
    expect(settingsSectionsFor(ctx({ uid: 'u2', isOwn: false }))).toEqual([])
    expect(settingsSectionsFor(ctx())).toHaveLength(1)
  })

  it('visible решает факт пункта', () => {
    registerSettingsSection(section('drive', { visible: (c) => c.canEdit }))
    expect(settingsSectionsFor(ctx({ canEdit: false }))).toEqual([])
  })

  it('canRead=false не показывает ничего', () => {
    registerSettingsSection(section('account'))
    expect(settingsSectionsFor(ctx({ canRead: false }))).toEqual([])
  })
})
