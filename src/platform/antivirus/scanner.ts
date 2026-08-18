import 'server-only'
import { Socket } from 'node:net'
import { env, isProduction } from '@config/env'
import { InfrastructureError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { logger } from '@core/logging/logger'

/**
 * Upload scanning.
 *
 * SUPABASE STORAGE DOES NOT SCAN UPLOADS. This stays ours, and it matters more here than in
 * a typical application: the public application form accepts files from anonymous
 * submitters, and those files are then opened by EthioStar staff on office machines.
 *
 * The port has one method and returns a verdict rather than throwing on INFECTED — an
 * infected file is an expected outcome that must be recorded against the row (the schema
 * has `quarantine_reason` for exactly this), not an exception that loses the reason.
 */

export type ScanVerdict =
  { readonly status: 'CLEAN' } | { readonly status: 'INFECTED'; readonly signature: string }

export interface VirusScanner {
  readonly name: string
  scan(content: Buffer): Promise<ScanVerdict>
}

/**
 * ClamAV over the INSTREAM protocol.
 *
 * Speaks to clamd directly on a TCP socket rather than shelling out to `clamdscan`, because
 * the file never touches disk on the way through — writing an untrusted upload to a
 * temporary path so a subprocess can read it is an extra place for it to be executed from.
 */
export class ClamAvScanner implements VirusScanner {
  readonly name = 'clamav'

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(content: Buffer): Promise<ScanVerdict> {
    const response = await this.instream(content)

    // clamd replies "stream: OK" or "stream: <signature> FOUND".
    if (response.includes('OK') && !response.includes('FOUND')) {
      return { status: 'CLEAN' }
    }

    const match = /stream:\s*(.+?)\s*FOUND/.exec(response)
    if (match?.[1]) {
      return { status: 'INFECTED', signature: match[1] }
    }

    throw new InfrastructureError(ERROR_CODES.INTERNAL, {
      message: `Unexpected clamd response: ${response.trim()}`,
    })
  }

  /** INSTREAM: `zINSTREAM\0` then length-prefixed chunks, terminated by a zero length. */
  private instream(content: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const chunks: Buffer[] = []
      let settled = false

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(
          new InfrastructureError(ERROR_CODES.INTERNAL, {
            message: `Virus scan failed: ${error.message}`,
            cause: error,
          }),
        )
      }

      socket.setTimeout(this.timeoutMs)
      socket.on('timeout', () => fail(new Error('clamd timed out')))
      socket.on('error', fail)
      socket.on('data', (chunk: Buffer) => chunks.push(chunk))
      socket.on('close', () => {
        if (settled) return
        settled = true
        resolve(Buffer.concat(chunks).toString('utf8'))
      })

      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0')

        // 64 KiB chunks: clamd's default StreamMaxLength rejects larger single writes.
        const CHUNK = 65_536
        for (let offset = 0; offset < content.length; offset += CHUNK) {
          const slice = content.subarray(offset, offset + CHUNK)
          const header = Buffer.alloc(4)
          header.writeUInt32BE(slice.length, 0)
          socket.write(header)
          socket.write(slice)
        }

        const terminator = Buffer.alloc(4)
        terminator.writeUInt32BE(0, 0)
        socket.write(terminator)
      })
    })
  }
}

/**
 * Development scanner that passes everything.
 *
 * REFUSES TO LOAD IN PRODUCTION. A no-op scanner silently in place in production is worse
 * than no scanner at all, because the `file_scan_result` row says CLEAN and everyone
 * downstream believes it.
 */
export class NoopScanner implements VirusScanner {
  readonly name = 'noop'

  constructor() {
    if (isProduction()) {
      throw new Error(
        'NoopScanner must never be constructed in production — configure CLAMAV_HOST.',
      )
    }
    logger.warn('virus scanning is DISABLED — uploads are not being scanned')
  }

  async scan(): Promise<ScanVerdict> {
    return { status: 'CLEAN' }
  }
}

let instance: VirusScanner | undefined

/**
 * The scanner this process should use.
 *
 * `env` already refuses to boot in production without `CLAMAV_HOST`, so the fallback below
 * is unreachable there — `NoopScanner`'s own constructor is the second guard.
 */
export function virusScanner(): VirusScanner {
  if (!instance) {
    instance =
      env.CLAMAV_HOST && env.CLAMAV_PORT
        ? new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT)
        : new NoopScanner()
  }
  return instance
}

/** Test seam. */
export function __setVirusScanner(value: VirusScanner | undefined): void {
  instance = value
}
