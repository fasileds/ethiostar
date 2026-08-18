import 'server-only'
import { SupabaseFileStorage } from './supabase-file-storage'
import type { FileStorage } from './file-storage'

export {
  buildObjectKey,
  sanitiseFilename,
  type FileStorage,
  type PutObjectInput,
} from './file-storage'
export { SupabaseFileStorage, FakeFileStorage } from './supabase-file-storage'

let instance: FileStorage | undefined

export function fileStorage(): FileStorage {
  instance ??= new SupabaseFileStorage()
  return instance
}

/** Test seam — inject a `FakeFileStorage`. */
export function __setFileStorage(value: FileStorage | undefined): void {
  instance = value
}
