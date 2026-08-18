import { describe, it, expect } from 'vitest'
import { detectContentType, verifyUpload } from './content-type'

const MAX = 10 * 1024 * 1024

const pdf = (): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)])
const jpeg = (): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const png = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ])
const webp = (): Buffer =>
  Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x40, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.alloc(64),
  ])

describe('detectContentType', () => {
  it('recognises each accepted format from its magic bytes', () => {
    expect(detectContentType(pdf())).toBe('application/pdf')
    expect(detectContentType(jpeg())).toBe('image/jpeg')
    expect(detectContentType(png())).toBe('image/png')
    expect(detectContentType(webp())).toBe('image/webp')
  })

  it('returns null for content it does not recognise', () => {
    expect(detectContentType(Buffer.from('<!DOCTYPE html><html>'))).toBeNull()
    // A Windows executable — the realistic case behind this whole module.
    expect(detectContentType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull()
    expect(detectContentType(Buffer.alloc(0))).toBeNull()
  })

  it('does not accept a RIFF container that is not WebP', () => {
    // A WAV file is also RIFF; only the WEBP fourcc at offset 8 makes it an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x40, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
      Buffer.alloc(64),
    ])
    expect(detectContentType(wav)).toBeNull()
  })

  it('does not read past the end of a short buffer', () => {
    expect(detectContentType(Buffer.from([0x89, 0x50]))).toBeNull()
    expect(detectContentType(Buffer.from('RIFF'))).toBeNull()
  })
})

describe('verifyUpload', () => {
  it('accepts a well-formed file and reports its real type and size', () => {
    const content = pdf()
    expect(verifyUpload('trade-licence.pdf', content, MAX)).toEqual({
      contentType: 'application/pdf',
      byteSize: content.length,
    })
  })

  it('accepts both JPEG extensions', () => {
    expect(verifyUpload('id.jpg', jpeg(), MAX).contentType).toBe('image/jpeg')
    expect(verifyUpload('id.jpeg', jpeg(), MAX).contentType).toBe('image/jpeg')
  })

  it('is case-insensitive about the extension', () => {
    expect(verifyUpload('LICENCE.PDF', pdf(), MAX).contentType).toBe('application/pdf')
  })

  it('rejects an empty file', () => {
    expect(() => verifyUpload('empty.pdf', Buffer.alloc(0), MAX)).toThrow(/empty/i)
  })

  it('rejects a file over the size cap', () => {
    const big = Buffer.concat([pdf(), Buffer.alloc(MAX)])
    expect(() => verifyUpload('big.pdf', big, MAX)).toThrow(/larger than/i)
  })

  /**
   * THE CONTROL THIS MODULE EXISTS FOR. An executable named `.pdf`, which a Customer
   * Service Officer would otherwise open on an office machine while verifying a KYC pack.
   */
  it('rejects an executable renamed to .pdf', () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)])
    expect(() => verifyUpload('trade-licence.pdf', exe, MAX)).toThrow(/not accepted/i)
  })

  it('rejects HTML renamed to .pdf', () => {
    expect(() =>
      verifyUpload('licence.pdf', Buffer.from('<!DOCTYPE html><script>'), MAX),
    ).toThrow(/not accepted/i)
  })

  it('rejects a real PDF carrying a mismatched extension', () => {
    expect(() => verifyUpload('licence.png', pdf(), MAX)).toThrow(
      /named ".png" but its contents are application\/pdf/i,
    )
  })

  it('rejects an extension that is not on the allow-list', () => {
    expect(() => verifyUpload('licence.exe', pdf(), MAX)).toThrow(
      /not an accepted file extension/i,
    )
  })

  it('rejects a file with no extension at all', () => {
    expect(() => verifyUpload('licence', pdf(), MAX)).toThrow(/no extension/i)
  })
})
