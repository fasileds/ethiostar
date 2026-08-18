import 'server-only'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '@react-pdf/renderer'
import { logger } from '@core/logging/logger'
import type { Locale } from '@config/constants'

/**
 * Font registration for M06.
 *
 * react-pdf ships Helvetica, Times and Courier. NONE of them contain Ethiopic glyphs, so an
 * Amharic document rendered without a registered Ethiopic family comes out as a page of
 * empty boxes — silently, with no error.
 *
 * That failure mode is unacceptable for these documents. A Mirt Merekebiya is the artefact
 * by which a customer accepts several tonnes of coffee; handing them one where the text did
 * not render, but the numbers and signature blocks did, produces a signed document nobody
 * can read back. So `assertFontsFor('am')` REFUSES rather than degrading.
 *
 * ⚠️ THE FONT FILES ARE NOT IN THIS REPOSITORY. Drop the four Noto Sans Ethiopic statics
 * into `public/fonts/` (see FONT_FILES below) and Amharic rendering starts working with no
 * code change. Until then English documents render correctly and Amharic ones fail loudly.
 * Roadmap Step 24 covers verifying Ethiopic shaping per document.
 */

const FONT_DIR = join(process.cwd(), 'public', 'fonts')

export const LATIN_FAMILY = 'Helvetica'
export const ETHIOPIC_FAMILY = 'NotoSansEthiopic'

const FONT_FILES = [
  { file: 'NotoSansEthiopic-Regular.ttf', fontWeight: 400 as const },
  { file: 'NotoSansEthiopic-Medium.ttf', fontWeight: 500 as const },
  { file: 'NotoSansEthiopic-SemiBold.ttf', fontWeight: 600 as const },
  { file: 'NotoSansEthiopic-Bold.ttf', fontWeight: 700 as const },
]

let registered: boolean | undefined

/**
 * Register the Ethiopic family if the files are present.
 *
 * Memoised: registration is global to the react-pdf module and repeating it on every render
 * leaks font buffers in a long-running worker.
 */
export function registerFonts(): boolean {
  if (registered !== undefined) return registered

  const available = FONT_FILES.filter(({ file }) => existsSync(join(FONT_DIR, file)))

  if (available.length === 0) {
    logger.warn(
      { fontDir: FONT_DIR, expected: FONT_FILES.map((f) => f.file) },
      'Ethiopic fonts not installed — Amharic documents will be refused, English is unaffected',
    )
    registered = false
    return false
  }

  Font.register({
    family: ETHIOPIC_FAMILY,
    fonts: available.map(({ file, fontWeight }) => ({
      src: join(FONT_DIR, file),
      fontWeight,
    })),
  })

  // react-pdf's default hyphenation splits words at arbitrary points, which is wrong for
  // Ethiopic and unhelpful for the short label text in these documents.
  Font.registerHyphenationCallback((word) => [word])

  if (available.length < FONT_FILES.length) {
    logger.warn(
      { found: available.length, expected: FONT_FILES.length },
      'some Ethiopic font weights are missing — react-pdf will synthesise the absent ones',
    )
  }

  registered = true
  return true
}

/** True when this locale can be rendered with the fonts actually installed. */
export function canRender(locale: Locale): boolean {
  return locale === 'en' ? true : registerFonts()
}

/**
 * Refuse to render a locale whose script has no font.
 *
 * Called at the top of every render. Failing here surfaces as a dead-lettered job and an
 * alert, which a person can act on; the alternative surfaces as a customer holding a blank
 * page, which nobody notices until a dispute.
 */
export function assertFontsFor(locale: Locale): void {
  if (canRender(locale)) return

  throw new Error(
    `Cannot render an ${locale} document: no Ethiopic font is installed. ` +
      `Place the Noto Sans Ethiopic TTF files in ${FONT_DIR}.`,
  )
}

/** The family a document body should use for this locale. */
export function familyFor(locale: Locale): string {
  return locale === 'am' ? ETHIOPIC_FAMILY : LATIN_FAMILY
}

/** Test seam — reset memoisation. */
export function __resetFontRegistration(): void {
  registered = undefined
}
