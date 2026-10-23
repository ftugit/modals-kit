import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import Attachment from './Attachment.svelte'

describe('Attachment SSR rendering (pure Node, no DOM/window)', () => {
  test('renders display attachment without inputs and never calls URL.createObjectURL on SSR', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL')
    const file = new File(['raw-image'], 'hero.png', { type: 'image/png' })
    const { body } = render(Attachment, {
      props: { file, layout: 'row', size: 'md' },
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(body).toContain('data-slot="attachment"')
    expect(body).toContain('data-layout="row"')
    expect(body).toContain('data-kind="image"')
    expect(body).toContain('hero.png')
    expect(body).not.toContain('<input')
    createSpy.mockRestore()
  })

  test('renders native radio in single mode and native checkbox in multiple mode with matching label[for]', () => {
    const single = render(Attachment, {
      props: {
        id: 'att-cover-1',
        filename: 'cover-1.webp',
        selection: 'single',
        name: 'coverId',
        value: 'c_1',
        defaultChecked: true,
      },
    })
    expect(single.body.match(/<input\b/g)).toHaveLength(1)
    expect(single.body).toContain('type="radio"')
    expect(single.body).toContain('name="coverId"')
    expect(single.body).toContain('value="c_1"')
    expect(single.body).toContain('id="att-cover-1"')
    expect(single.body).toContain('for="att-cover-1"')
    expect(single.body).toContain('checked')

    const multi = render(Attachment, {
      props: {
        id: 'att-doc-2',
        filename: 'spec.pdf',
        selection: 'multiple',
        name: 'attachmentIds',
        value: 'd_2',
        showFilename: false,
        showSize: false,
        layout: 'tile',
      },
    })
    expect(multi.body.match(/<input\b/g)).toHaveLength(1)
    expect(multi.body).toContain('type="checkbox"')
    expect(multi.body).toContain('name="attachmentIds"')
    expect(multi.body).toContain('value="d_2"')
    expect(multi.body).toContain('for="att-doc-2"')
    // Even with visible filename/size hidden, screen-reader text remains inside <label>.
    expect(multi.body).toContain('<span class="sr-only">spec.pdf</span>')
  })

  test('renders determinate and indeterminate accessible progressbars and all semantic states', () => {
    const determinate = render(Attachment, {
      props: {
        filename: 'archive.tar.gz',
        state: 'uploading',
        progress: 64,
        progressVariant: 'strip',
      },
    })
    expect(determinate.body).toContain('role="progressbar"')
    expect(determinate.body).toContain('aria-valuemin="0"')
    expect(determinate.body).toContain('aria-valuemax="100"')
    expect(determinate.body).toContain('aria-valuenow="64"')
    expect(determinate.body).toContain('Загрузка 64%')

    const indeterminate = render(Attachment, {
      props: {
        filename: 'dataset.csv',
        state: 'processing',
        progressVariant: 'background',
      },
    })
    expect(indeterminate.body).toContain('data-variant="background"')
    expect(indeterminate.body).toContain('role="progressbar"')
    expect(indeterminate.body).not.toContain('aria-valuenow=')
    expect(indeterminate.body).toContain('Обработка…')

    const errored = render(Attachment, {
      props: {
        filename: 'broken.png',
        state: 'error',
        error: 'Превышен лимит 10 МиБ',
      },
    })
    expect(errored.body).toContain('data-state="error"')
    expect(errored.body).toContain('Превышен лимит 10 МиБ')
  })
})
