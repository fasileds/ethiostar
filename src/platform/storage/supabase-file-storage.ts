import 'server-only'
import { env } from '@config/env'
import { InfrastructureError, NotFoundError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { createAdminClient } from '../supabase/admin-client'
import type { FileStorage, PutObjectInput } from './file-storage'

/**
 * Supabase Storage adapter against a PRIVATE bucket.
 *
 * Service-role is used deliberately and confined here. Storage RLS on `storage.objects`
 * would have to reproduce the authorisation rules of every owning record — a customer's
 * KYC document, a consignment's photograph, a rendered gate pass — which means the same
 * rule expressed twice, in two languages, drifting apart. Instead the application performs
 * the check against the owning record and this adapter carries bytes.
 *
 * That trade is only safe because the bucket is private and no raw object URL works:
 * every download goes through a signed URL minted after a check.
 */
export class SupabaseFileStorage implements FileStorage {
  readonly name = 'supabase-storage'
  readonly bucket = env.SUPABASE_STORAGE_BUCKET

  private get objects() {
    return createAdminClient().storage.from(this.bucket)
  }

  async put(input: PutObjectInput): Promise<void> {
    const { error } = await this.objects.upload(input.objectKey, input.body, {
      contentType: input.contentType,
      // Never overwrite. An object key contains the file UUID, so a collision means a bug
      // or a replay — and silently replacing a customer's trade licence with different
      // bytes under the same id would destroy the audit trail's meaning.
      upsert: false,
    })

    if (error) {
      throw new InfrastructureError(ERROR_CODES.INTERNAL, {
        message: `Storage upload failed: ${error.message}`,
        cause: error,
      })
    }
  }

  async get(objectKey: string): Promise<Buffer> {
    const { data, error } = await this.objects.download(objectKey)

    if (error || !data) {
      throw NotFoundError.of('File', objectKey)
    }

    return Buffer.from(await data.arrayBuffer())
  }

  async signedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.objects.createSignedUrl(objectKey, expiresInSeconds)

    if (error || !data) {
      throw NotFoundError.of('File', objectKey)
    }

    return data.signedUrl
  }

  async remove(objectKey: string): Promise<void> {
    const { error } = await this.objects.remove([objectKey])

    if (error) {
      throw new InfrastructureError(ERROR_CODES.INTERNAL, {
        message: `Storage delete failed: ${error.message}`,
        cause: error,
      })
    }
  }
}

/**
 * In-memory test double.
 *
 * Kept beside the real adapter so a test cannot pick the Supabase one by autocomplete and
 * quietly start writing to a real bucket.
 */
export class FakeFileStorage implements FileStorage {
  readonly name = 'fake'
  readonly bucket = 'fake-bucket'
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>()

  async put(input: PutObjectInput): Promise<void> {
    if (this.objects.has(input.objectKey)) {
      throw new Error(`FakeFileStorage: object ${input.objectKey} already exists`)
    }
    this.objects.set(input.objectKey, { body: input.body, contentType: input.contentType })
  }

  async get(objectKey: string): Promise<Buffer> {
    const object = this.objects.get(objectKey)
    if (!object) throw NotFoundError.of('File', objectKey)
    return object.body
  }

  async signedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(objectKey)) throw NotFoundError.of('File', objectKey)
    return `https://fake.storage/${objectKey}?expires=${expiresInSeconds}`
  }

  async remove(objectKey: string): Promise<void> {
    this.objects.delete(objectKey)
  }

  reset(): void {
    this.objects.clear()
  }
}
