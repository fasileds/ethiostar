/**
 * The `<input type="file">` naming convention shared between `ApplyForm` and `actions.ts`.
 *
 * Document types are dynamic (which ones apply depends on the business type chosen), so they
 * cannot be static fields on the Zod schema the way every other field is — the schema can't
 * name a field it doesn't know exists yet. Keying by `doc_<documentTypeId>` lets the action
 * find them in the raw FormData by pattern instead.
 */
export function documentFieldName(documentTypeId: string): string {
  return `doc_${documentTypeId}`
}

export const DOCUMENT_FIELD_PREFIX = 'doc_'
