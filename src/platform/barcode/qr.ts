import 'server-only'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

/**
 * QR generation for M06.
 *
 * "A unique QR code per consignment and per lot. Scanning it with a phone or handheld shows
 * the full history of that coffee." (Solution Overview §5, M06)
 *
 * Two rules the key control depends on:
 *
 *  1. The code encodes a VERIFICATION TOKEN, never a database id. A sequential or guessable
 *     value would let anyone who photographs one bag's tag enumerate every other customer's
 *     consignments — and the scan endpoint is reachable without authentication by design,
 *     because the person holding the phone at the gate is often not a system user.
 *  2. Output is a PNG data URI, embeddable directly in a react-pdf `<Image>`. No file, no
 *     temp directory, no cleanup — a rendering process that writes to disk is a rendering
 *     process that fills a disk.
 */

/**
 * A scan token.
 *
 * 160 bits from `randomBytes`, base64url. Long enough that enumeration is not a strategy,
 * short enough that the resulting QR stays at a low error-correction-friendly density and
 * scans reliably off a creased hanging tag in a dim store room.
 */
export function generateVerificationToken(): string {
  return randomBytes(20).toString('base64url')
}

export interface QrOptions {
  /**
   * Module size in pixels. 6 gives roughly a 25 mm code at 150 dpi, which is the smallest
   * that scans reliably off a thermal label under store lighting.
   */
  readonly scale?: number
  readonly margin?: number
}

/**
 * Render a QR code as a PNG data URI.
 *
 * Error correction level M (~15% recovery) rather than the default. Labels on coffee sacks
 * get scuffed, folded and rained on between the receiving bay and the gate; L saves a little
 * density but fails on exactly the damaged tags where a scan matters most. H would be more
 * robust still, but pushes the module count high enough that a 25 mm label stops scanning.
 */
export async function qrPngDataUri(content: string, options: QrOptions = {}): Promise<string> {
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    scale: options.scale ?? 6,
    margin: options.margin ?? 2,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

/** The URL a scan resolves to. Public by design — the gate officer may not be a system user. */
export function verificationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/scan/${token}`
}
