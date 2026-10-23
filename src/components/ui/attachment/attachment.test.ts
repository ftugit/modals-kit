import { describe, expect, test } from 'vitest'
import {
  clampProgress,
  formatAttachmentBytes,
  inferAttachmentKind,
  normalizeAttachment,
  selectedItemsByValues,
  toAttachmentOption,
  toggleAttachmentValue,
  type AttachmentItem,
} from './model'

describe('Attachment model: kind inference, formatting, normalization, selection helpers', () => {
  test('inferAttachmentKind maps all 6 categories and falls back to generic file', () => {
    expect(inferAttachmentKind('image/webp', 'cover.bin')).toBe('image')
    expect(inferAttachmentKind('video/mp4', 'clip')).toBe('video')
    expect(inferAttachmentKind('audio/ogg; codecs=opus', 'voice')).toBe('audio')
    expect(inferAttachmentKind('application/zip', 'bundle')).toBe('archive')
    expect(inferAttachmentKind('application/json', 'data')).toBe('code')
    expect(inferAttachmentKind('text/csv; charset=utf-8', 'table')).toBe('document')
    expect(inferAttachmentKind('', 'schema.svelte')).toBe('code')
    expect(inferAttachmentKind('application/octet-stream', 'backup.7z')).toBe('archive')
    expect(inferAttachmentKind('application/octet-stream', 'contract.pdf')).toBe('document')
    expect(inferAttachmentKind('application/octet-stream', 'blob-without-known-ext.bin')).toBe('file')
    expect(inferAttachmentKind(undefined, undefined)).toBe('file')
  })

  test('formatAttachmentBytes and clampProgress handle boundary values safely', () => {
    expect(formatAttachmentBytes(-10)).toBe('0 Б')
    expect(formatAttachmentBytes(Number.NaN)).toBe('0 Б')
    expect(formatAttachmentBytes(512)).toBe('512 Б')
    expect(formatAttachmentBytes(2048)).toBe('2 КиБ')
    expect(formatAttachmentBytes(5 * 1024 * 1024)).toBe('5.0 МиБ')
    expect(formatAttachmentBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 ГиБ')

    expect(clampProgress(undefined)).toBeNull()
    expect(clampProgress(null)).toBeNull()
    expect(clampProgress(Number.NaN)).toBeNull()
    expect(clampProgress(-15)).toBe(0)
    expect(clampProgress(42.6)).toBe(43)
    expect(clampProgress(180)).toBe(100)
  })

  test('normalizeAttachment separates AttachmentItem display fields from AttachmentOption form value', () => {
    const item: AttachmentItem = {
      id: 'att_42',
      filename: 'quarterly-report.pdf',
      byteSize: 102_400,
      mimeType: 'application/pdf',
      previewUrl: 'https://cdn.example/thumbs/att_42.webp',
    }
    const norm = normalizeAttachment({ item })
    expect(norm.filename).toBe('quarterly-report.pdf')
    expect(norm.kind).toBe('document')
    expect(norm.sizeText).toBe('100 КиБ')
    expect(norm.remotePreviewUrl).toBe('https://cdn.example/thumbs/att_42.webp')
    expect(norm.localFile).toBeUndefined()
    // Form value is strictly the string ID, never previewUrl or JSON stringification.
    expect(norm.option.value).toBe('att_42')
    expect(norm.option.label).toBe('quarterly-report.pdf')
    expect(norm.option.hint).toBe('100 КиБ')
  })

  test('normalizeAttachment distinguishes local File object from string preview URL strictly by type', () => {
    const file = new File(['png-bytes'], 'avatar.png', { type: 'image/png' })
    const norm = normalizeAttachment({
      file,
      previewUrl: 'https://should-not-win-over-local-file.example/x.png',
    })
    expect(norm.localFile).toBe(file)
    expect(norm.remotePreviewUrl).toBeUndefined()
    expect(norm.kind).toBe('image')
    expect(norm.filename).toBe('avatar.png')
  })

  test('toAttachmentOption, toggleAttachmentValue and selectedItemsByValues handle single and multiple modes', () => {
    const items: AttachmentItem[] = [
      { id: 'a1', filename: 'one.png', byteSize: 1024 },
      { id: 'a2', filename: 'two.pdf', byteSize: 4096 },
      { id: 'a3', filename: 'three.zip', byteSize: 8192 },
    ]
    const options = items.map((it) => toAttachmentOption(it))
    expect(options.map((o) => o.value)).toEqual(['a1', 'a2', 'a3'])

    let multi = toggleAttachmentValue([], 'a1', 'multiple')
    multi = toggleAttachmentValue(multi, 'a3', 'multiple')
    expect(multi).toEqual(['a1', 'a3'])
    expect(toggleAttachmentValue(multi, 'a2', 'multiple', true)).toEqual(['a1', 'a3'])
    multi = toggleAttachmentValue(multi, 'a1', 'multiple')
    expect(multi).toEqual(['a3'])

    let single = toggleAttachmentValue([], 'a1', 'single')
    single = toggleAttachmentValue(single, 'a2', 'single')
    expect(single).toEqual(['a2'])

    expect(selectedItemsByValues(items, ['a3', 'a1']).map((x) => x.id)).toEqual(['a1', 'a3'])
  })
})
