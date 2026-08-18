/**
 * Server bootstrap. Runs ONCE when a Next.js server instance starts, and must complete
 * before the server handles requests.
 *
 * Its job is to fail loudly and early: a misconfigured deploy should be obvious in the
 * first log line, not on the first request that happens to need SMTP_HOST.
 *
 * docs/architecture/06-cross-cutting.md §6.1
 */
export async function register(): Promise<void> {
  // Node.js runtime only. Next calls register() in every runtime, so guard imports of
  // anything Node-specific.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { loadEnv } = await import('@config/env')
  const { configureLogger, logger } = await import('@core/logging/logger')

  // Throws with every offending variable named. Fail to START, not to serve.
  const env = loadEnv()

  configureLogger({
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
    service: 'cpms-web',
  })

  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      appUrl: env.APP_URL,
      locale: env.DEFAULT_LOCALE,
      poolMax: env.DATABASE_POOL_MAX,
    },
    'CPMS server starting',
  )

  // Timezone discipline: every process runs in UTC, and business dates are converted to
  // Africa/Addis_Ababa in core/utils/date.ts. A server running in local time misfiles
  // every receipt taken after 21:00 UTC.
  if (process.env.TIME_ZONE !== 'UTC') {
    logger.warn(
      { tz: process.env.TIME_ZONE },
      'TIME_ZONE is not UTC — business-date calculations assume UTC storage',
    )
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    logger.info({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }, 'OpenTelemetry configured')
    // OTel SDK registration lands with Step 8's observability work.
  }
}

/**
 * Called when a request throws. Next 16 passes the error plus request context, which gives
 * a single funnel for unhandled server errors.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { logger } = await import('@core/logging/logger')
  logger.error(
    {
      err: error instanceof Error ? { name: error.name, message: error.message } : error,
      path: request.path,
      method: request.method,
      requestId: request.headers['x-request-id'],
    },
    'unhandled request error',
  )
}
