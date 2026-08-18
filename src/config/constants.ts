/**
 * Compile-time constants. Values here never change without a deploy, by definition.
 * Anything an administrator should be able to change belongs in @config/settings (M23).
 */

/** Supported UI and document locales. */
export const LOCALES = ['en', 'am'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  am: 'አማርኛ',
}

/**
 * The plant's timezone. Storage is always UTC; this is used to compute the *business* day.
 * "Coffee received today" computed in UTC misfiles every receipt between 21:00 and midnight
 * local — which is the end of every working day during peak intake.
 */
export const BUSINESS_TIMEZONE = 'Africa/Addis_Ababa' as const

/** Ethiopia does not observe daylight saving; the offset is constant. */
export const BUSINESS_UTC_OFFSET_MINUTES = 180

export const DEFAULT_CURRENCY = 'ETB' as const

/** Weight is stored as numeric(14,3): kilograms to the gram. */
export const WEIGHT_DECIMAL_PLACES = 3
/** Money is stored as numeric(14,2). */
export const MONEY_DECIMAL_PLACES = 2
/** Percentages are stored as numeric(6,3). */
export const PERCENT_DECIMAL_PLACES = 3

/** Actor realms. A staff user and a customer never share a shell or a data scope. */
export const ACTOR_KINDS = ['staff', 'customer'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

/** Cookie names. `__Host-` prefix is applied in production only (it requires https). */
export const COOKIE_LOCALE = 'cpms-locale'
export const HEADER_REQUEST_ID = 'x-request-id'
export const HEADER_CORRELATION_ID = 'x-correlation-id'
export const HEADER_LOCALE = 'x-cpms-locale'
export const HEADER_CSP_NONCE = 'x-cpms-nonce'

/** Upload allow-list. Extension AND magic bytes must both agree — they often do not. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'] as const

/** Pagination defaults. Keyset, never OFFSET, on ledger and audit tables. */
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 200

/** Hard cap on synchronous exports; above this the export becomes a background job. */
export const MAX_SYNC_EXPORT_ROWS = 5_000

/**
 * The four processing outputs (M15). These are ROWS in `output_classification`, not an enum —
 * M02 requires that additional classifications can be added without redevelopment.
 * These constants are the stable `code` values that carry special behaviour in code.
 */
export const OUTPUT_CLASSIFICATION_CODES = {
  APPROVED: 'APPROVED',
  C_GRADE: 'C_GRADE',
  GRAVITY: 'GRAVITY',
  COLOUR_SORTER: 'COLOUR_SORTER',
} as const

/** Only this classification is the export-ready primary output. */
export const PRIMARY_OUTPUT_CODE = OUTPUT_CLASSIFICATION_CODES.APPROVED

/** Document numbering series codes (M06). */
export const DOCUMENT_SERIES = {
  APPLICATION: 'APP',
  CUSTOMER: 'CUS',
  /** Internal reference numbers, not printed documents — allocated through the same
   * gapless mechanism so there is one numbering system rather than two. */
  CONSIGNMENT: 'CNS',
  LOT: 'LOT',
  DELIVERY_REQUEST: 'DR',
  GOODS_RECEIPT: 'GRN',
  STORE_PLACEMENT: 'SP',
  STORE_TRANSFER: 'ST',
  STOCK_ADJUSTMENT: 'ADJ',
  STOCK_COUNT: 'CNT',
  PROCESSING_REQUEST: 'PR',
  APPOINTMENT: 'APT',
  JOB_ORDER: 'JOB',
  RELEASE_REQUEST: 'RR',
  YIELD_STATEMENT: 'YLD',
  MIRT_MEREKEBIYA: 'MIRT',
  LOADING_LIST: 'LL',
  DISPATCH_NOTE: 'DN',
  GATE_PASS: 'GP',
  LABOUR_VOUCHER: 'LV',
  /** M19 — Phase 2. */
  PROFORMA_INVOICE: 'PFI',
  TAX_INVOICE: 'INV',
  RECEIPT: 'RCT',
  ACCOUNT_STATEMENT: 'STM',
  /** M10 — Phase 2. */
  CONTRACT: 'CTR',
} as const

export type DocumentSeriesCode = (typeof DOCUMENT_SERIES)[keyof typeof DOCUMENT_SERIES]
