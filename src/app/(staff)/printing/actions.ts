'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { printDocument, type PrintDocumentResult } from '@server/documents/print-document'
import type { RegisteredDocumentType } from '@server/documents/registry'

const schema = z.object({
  documentType: z.string().min(1),
  sourceId: z.string().uuid(),
  locale: z.enum(['en', 'am']).optional(),
  reprintReason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

/**
 * The one server action every "Print" / "Reprint" button in the staff app calls, regardless
 * of document type — `printDocument` (server/documents/print-document.ts) already does the
 * dispatching by `documentType` via the registry.
 */
export const printDocumentAction = withAction({
  name: 'printing.printDocument',
  permission: 'document:print',
  schema,
  handler: async (input, ctx): Promise<PrintDocumentResult> => {
    const result = await printDocument(ctx.claims, ctx.actor, {
      documentType: input.documentType as RegisteredDocumentType,
      sourceId: input.sourceId,
      ...(input.locale ? { locale: input.locale } : {}),
      reprintReason: input.reprintReason ?? null,
    })
    revalidatePath('/printing')
    return result
  },
})
