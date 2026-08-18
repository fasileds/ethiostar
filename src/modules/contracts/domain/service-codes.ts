/**
 * The billable events M19 raises charges for. A tariff line is keyed by one of these codes,
 * and a rate cannot exist for anything else — the CHECK is enforced at the domain level here
 * because the database column is a free-text `service_code` with no matching constraint.
 */
export const SERVICE_CODES = {
  UNLOADING: 'UNLOADING',
  LOADING: 'LOADING',
  STORAGE_PER_DAY: 'STORAGE_PER_DAY',
  PROCESSING_PER_KG: 'PROCESSING_PER_KG',
  BAGGING: 'BAGGING',
  REBAGGING: 'REBAGGING',
  SPECIAL_HANDLING: 'SPECIAL_HANDLING',
} as const

export type ServiceCode = (typeof SERVICE_CODES)[keyof typeof SERVICE_CODES]

export const SERVICE_CODE_LIST: readonly ServiceCode[] = Object.values(SERVICE_CODES)
