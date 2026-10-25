import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import { defineForm, field, v } from '#lib/form/index.js'
import { bind, createConfig, type BoundConfig } from '#lib/form/svelte/index.js'
import FileFieldHost from './FileFieldHost.test.svelte'
import { resolve } from './resolve.js'

const cfg: BoundConfig = createConfig({ resolve })

const desc = defineForm({
  id: 'file-field-ssr',
  revision: 1,
  actions: [{ id: 'submit', validate: 'full' }],
  fields: {
    cover: field.file({
      label: 'Обложка',
      variant: 'preview',
      validate: [v.required(), v.accept(['image/png']), v.maxSize(1024 * 1024)],
    }),
    docs: field.files({
      label: 'Документы',
      validate: [v.maxCount(3), v.maxSize(1024 * 1024)],
    }),
    gallery: field.files({
      label: 'Галерея',
      variant: 'preview',
      validate: [v.accept(['image/png', 'application/pdf']), v.maxSize(1024 * 1024)],
    }),
  },
})

describe('FileField SSR', () => {
  it('renders native file controls without preview markup or dead buttons across default and preview variants', () => {
    const bound = bind(cfg, desc, { action: '/upload' })
    const { body } = render(FileFieldHost, { props: { bound } })

    expect(body).toContain('name="cover"')
    expect(body).toContain('name="docs"')
    expect(body).toContain('name="gallery"')
    expect(body).toContain('type="file"')
    expect(body).toContain('accept="image/png,application/pdf"')
    expect(body).toContain('multiple')
    expect(body).toContain('required')
    expect(body).not.toContain('data-slot="attachment"')
    expect(body).not.toContain('data-file-list')
    expect(body).not.toContain('<button')
  })
})
