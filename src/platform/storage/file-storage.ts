import 'server-only'

/**
 * The `FileStorage` port.
 *
 * The bytes live in Supabase Storage; `stored_file` holds the metadata and the
 * access-control record. Two rules from `src/db/schema/files.ts` shape this interface:
 *
 *  1. Nothing is served by public URL. `signedUrl` mints a short-lived URL AFTER the caller
 *     has run the same authorisation check the owning record uses. An object key is not a
 *     permission.
 *  2. The metadata row is written PENDING before the upload. An upload that dies halfway
 *     leaves a row a worker can sweep, rather than an orphan object nobody knows about.
 */

export interface PutObjectInput {
  readonly objectKey: string
  readonly body: Buffer
  readonly contentType: string
}

export interface FileStorage {
  readonly name: string
  readonly bucket: string

  put(input: PutObjectInput): Promise<void>
  get(objectKey: string): Promise<Buffer>
  /** A time-limited download URL. Never persisted — minted per request. */
  signedUrl(objectKey: string, expiresInSeconds: number): Promise<string>
  remove(objectKey: string): Promise<void>
}

/**
 * Object key layout: `<sourceType>/<yyyy>/<mm>/<fileId>-<safeName>`.
 *
 * The file UUID is in the key so a key cannot be guessed from a customer name and a date,
 * and the date prefix keeps bucket listings navigable for an administrator restoring from a
 * backup. The original filename is preserved (sanitised) so a downloaded document is still
 * recognisable in a person's downloads folder.
 */
export function buildObjectKey(
  sourceType: string,
  fileId: string,
  originalFilename: string,
  now: Date,
): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${sanitiseSegment(sourceType)}/${year}/${month}/${fileId}-${sanitiseFilename(originalFilename)}`
}

/**
 * Strip anything that could traverse or confuse a path.
 *
 * Deliberately aggressive: a filename arrives from a browser on an unauthenticated
 * application form, and `../../` in an object key is a write outside the intended prefix.
 */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 100)
  return cleaned.length > 0 ? cleaned : 'file'
}

function sanitiseSegment(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return cleaned.length > 0 ? cleaned : 'other'
}
