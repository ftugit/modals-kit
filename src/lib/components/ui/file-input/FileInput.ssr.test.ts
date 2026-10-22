import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import FileInput from './FileInput.svelte'

describe('FileInput SSR', () => {
  test('renders only native <input type="file"> with form attributes and zero client preview markup', () => {
    expect(typeof window).toBe('undefined')

    const { body } = render(FileInput, {
      props: {
        id: 'avatar-upload',
        name: 'avatar',
        accept: 'image/png,image/webp',
        multiple: true,
        required: true,
        disabled: false,
        preview: true,
        'aria-invalid': true,
      },
    })

    expect(body).toContain('<input')
    expect(body).toContain('type="file"')
    expect(body).toContain('id="avatar-upload"')
    expect(body).toContain('name="avatar"')
    expect(body).toContain('accept="image/png,image/webp"')
    expect(body).toContain('multiple')
    expect(body).toContain('required')
    expect(body).toContain('aria-invalid="true"')

    expect(body).not.toContain('data-file-list')
    expect(body).not.toContain('data-file-item')
    expect(body).not.toContain('<ul')
    expect(body).not.toContain('<button')
    expect(body).not.toContain('<img')
  })
})
