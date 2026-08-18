import 'server-only'
import type { ReactElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { InfrastructureError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { assertFontsFor, registerFonts } from './fonts'

/**
 * The `DocumentRenderer` port (docs/adr/0012-pdf-rendering.md).
 *
 * Behind a port because M21's Phase 2 chart-heavy exports may need a Chromium adapter for
 * those documents specifically, while Phase 1's tables and headers do not justify a browser
 * in the production image.
 *
 * RENDERING NEVER HAPPENS INSIDE A BUSINESS TRANSACTION. A render holds CPU for tens to
 * hundreds of milliseconds and allocates several megabytes; doing that while holding the row
 * lock on a document number series would serialise every goods receipt in the plant behind
 * a font shaper. Callers allocate the number, commit, and render from the outbox.
 */

export interface DocumentRenderer {
  readonly name: string
  render(element: ReactElement<DocumentProps>, locale: Locale): Promise<Buffer>
}

export class ReactPdfRenderer implements DocumentRenderer {
  readonly name = 'react-pdf'

  async render(element: ReactElement<DocumentProps>, locale: Locale): Promise<Buffer> {
    // Refuses an Amharic document when no Ethiopic font is installed, rather than emitting
    // a page of empty boxes that looks like a successful render.
    assertFontsFor(locale)
    registerFonts()

    try {
      return await renderToBuffer(element)
    } catch (error) {
      throw new InfrastructureError(ERROR_CODES.INTERNAL, {
        message: `PDF render failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
  }
}

let instance: DocumentRenderer | undefined

export function documentRenderer(): DocumentRenderer {
  instance ??= new ReactPdfRenderer()
  return instance
}

/** Test seam. */
export function __setDocumentRenderer(value: DocumentRenderer | undefined): void {
  instance = value
}
