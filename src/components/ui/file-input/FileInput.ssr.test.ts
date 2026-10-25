import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import FileInput from './FileInput.svelte'

describe('FileInput SSR', () => {
  test('renders pure native <input type="file"> with form attributes and zero wrapper markup', () => {
    expect(typeof window).toBe('undefined')

    const { body } = render(FileInput, {
      props: {
        id: 'photo-upload',
        name: 'photo',
        accept: 'image/png,image/webp',
        multiple: true,
        required: true,
        disabled: false,
        'aria-invalid': true,
      },
    })

    expect(body).toContain('<input')
    expect(body).toContain('type="file"')
    expect(body).toContain('id="photo-upload"')
    expect(body).toContain('name="photo"')
    expect(body).toContain('accept="image/png,image/webp"')
    expect(body).toContain('multiple')
    expect(body).toContain('required')
    expect(body).toContain('aria-invalid="true"')

    expect(body).not.toContain('data-file-list')
    expect(body).not.toContain('<ul')
    expect(body).not.toContain('<button')
  })
})
