/**
 * M05 seam — file service.
 *
 * Phase 1 needs storage, scanning and authorised retrieval so that KYC documents, request
 * letters and rendered PDFs have somewhere to live. Phase 2 adds staff-recorded e-signature
 * and logical-document version history; expiry blocking and supersede chains remain open.
 *
 * Key control: uploaded files are scanned and restricted to approved formats and size
 * limits, verified by MAGIC BYTES rather than by the extension the browser claimed.
 */

export {
  uploadFile,
  uploadFileWithRunner,
  type UploadFileInput,
  type UploadedFile,
} from './application/upload-file'

export {
  signedDownloadUrl,
  downloadFileBytes,
  type DownloadContext,
} from './application/download-file'

export {
  detectContentType,
  verifyUpload,
  type DetectedType,
  type VerifiedUpload,
} from './domain/content-type'

export {
  findFile,
  listFilesFor,
  logFileAccess,
  insertPendingFile,
  markFileAvailable,
  markFileQuarantined,
  type FileRecord,
} from './infrastructure/file.repository'

export {
  captureSignature,
  listSignaturesFor,
  createDocumentVersion,
  listVersionHistory,
  type CaptureSignatureInput,
  type CreateDocumentVersionInput,
} from './application/sign-document'

export {
  type DocumentSignatureRow,
  type DocumentVersionRow,
} from './infrastructure/document-signature.repository'
