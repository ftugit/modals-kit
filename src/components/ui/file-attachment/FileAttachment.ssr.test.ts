import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import FileAttachment from './FileAttachment.svelte'

describe('FileAttachment SSR contract (progressive enhancement)', () => {
  test('renders native file input with form attributes and zero client preview or buttons on SSR', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL')
    const { body } = render(FileAttachment, {
      props: {
        id: 'company-docs',
        name: 'docs',
        accept: 'image/*,application/pdf',
        multiple: true,
        required: true,
      },
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(body).toContain('data-slot="file-attachment"')
    expect(body).toContain('type="file"')
    expect(body).toContain('id="company-docs"')
    expect(body).toContain('name="docs"')
    expect(body).toContain('accept="image/*,application/pdf"')
    expect(body).toContain('multiple')
    expect(body).toContain('required')
    expect(body).not.toContain('data-file-list')
    expect(body).not.toContain('data-file-item')
    expect(body).not.toContain('<button')
    createSpy.mockRestore()
  })
})
