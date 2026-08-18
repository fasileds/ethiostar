import { extname } from 'node:path'
import { ValidationError } from '@core/errors/app-error'
import { ALLOWED_UPLOAD_MIME_TYPES, ALLOWED_UPLOAD_EXTENSIONS } from '@config/constants'

/**
 * Content-type verification by MAGIC BYTES, not by extension or by the browser's
 * `Content-Type` header.
 *
 * Both of those are attacker-supplied. The realistic attack here is not exotic: an applicant
 * uploads `trade-licence.pdf` which is actually an HTML file or a Windows executable, and a
 * Customer Service Officer opens it on an office machine to verify the application. The
 * declared type is a claim; the first bytes are evidence.
 *
 * Pure — no I/O, no config beyond the static allow-list, so the whole rule is unit-testable.
 */

export type DetectedType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

interface Signature {
  readonly type: DetectedType
  readonly offset: number
  readonly bytes: readonly number[]
  /** Second check at another offset, for container formats like RIFF/WebP. */
  readonly also?: { readonly offset: number; readonly bytes: readonly number[] }
}

const SIGNATURES: readonly Signature[] = [
  // "%PDF-"
  { type: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // SOI + marker. Covers JFIF, Exif and raw JPEG alike.
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // "RIFF" … "WEBP" — the four size bytes between them are content, so both ends are checked.
  {
    type: 'image/webp',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46],
    also: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  },
]

function matchesAt(content: Buffer, offset: number, bytes: readonly number[]): boolean {
  if (content.length < offset + bytes.length) return false
  return bytes.every((byte, index) => content[offset + index] === byte)
}

/** The real type of these bytes, or `null` when nothing recognised matches. */
export function detectContentType(content: Buffer): DetectedType | null {
  for (const signature of SIGNATURES) {
    if (!matchesAt(content, signature.offset, signature.bytes)) continue
    if (signature.also && !matchesAt(content, signature.also.offset, signature.also.bytes)) {
      continue
    }
    return signature.type
  }
  return null
}

/** Extensions that legitimately carry each detected type. */
const EXTENSIONS_FOR: Readonly<Record<DetectedType, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
}

export interface VerifiedUpload {
  readonly contentType: DetectedType
  readonly byteSize: number
}

/**
 * Verify an upload before it is stored.
 *
 * Four rules, in the order that fails cheapest first:
 *   1. not empty
 *   2. within the size cap
 *   3. magic bytes match a type on the allow-list
 *   4. the extension agrees with the actual bytes
 *
 * Rule 4 is what stops `payload.exe` renamed to `licence.pdf` — rule 3 alone would already
 * reject that, but a PDF renamed to `.png` also indicates something is wrong, and a
 * mismatch is never innocent enough to store silently.
 */
function reject(message: string, code: string, fieldMessage: string): never {
  throw new ValidationError({
    message,
    fieldErrors: [{ path: 'file', code, message: fieldMessage }],
  })
}

function assertSize(content: Buffer, maxBytes: number): void {
  if (content.length === 0) {
    reject('The uploaded file is empty.', 'empty', 'The file is empty.')
  }

  if (content.length > maxBytes) {
    const limitMb = Math.floor(maxBytes / (1024 * 1024))
    reject(
      `The file is larger than the ${limitMb} MB limit.`,
      'too_large',
      `Maximum size is ${limitMb} MB.`,
    )
  }
}

function assertExtensionAgrees(filename: string, detected: DetectedType): void {
  const extension = extname(filename).toLowerCase()

  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    reject(
      `"${extension || 'no extension'}" is not an accepted file extension.`,
      'unsupported_extension',
      'Unsupported file extension.',
    )
  }

  if (!EXTENSIONS_FOR[detected].includes(extension)) {
    reject(
      `This file is named "${extension}" but its contents are ${detected}. Rename it or upload the correct file.`,
      'extension_mismatch',
      'The file extension does not match the file contents.',
    )
  }
}

export function verifyUpload(
  filename: string,
  content: Buffer,
  maxBytes: number,
): VerifiedUpload {
  assertSize(content, maxBytes)

  const detected = detectContentType(content)

  if (!detected || !(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(detected)) {
    reject(
      'That file type is not accepted. Upload a PDF, JPG, PNG or WebP.',
      'unsupported_type',
      'Only PDF, JPG, PNG and WebP files are accepted.',
    )
  }

  assertExtensionAgrees(filename, detected)

  return { contentType: detected, byteSize: content.length }
}
