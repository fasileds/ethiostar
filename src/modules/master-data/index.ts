/**
 * M02 — Organisation & Master Data Management.
 *
 * "Getting master data right at the start is what prevents the same coffee grade being
 * spelled three different ways and making the yield report meaningless."
 */

export {
  versionAsOf,
  requireVersionAsOf,
  currentVersion,
  assertNoOverlap,
  closingDateFor,
  sortByEffectiveFrom,
  coverageGaps,
  type EffectiveDated,
} from './domain/effective-version'

export { reasonCodesByCategory, type ReasonCodeOption } from './application/reason-codes.query'

export {
  listReasonCodeCategories,
  listAllReasonCodes,
  createReasonCode,
  setReasonCodeActive,
  type ReasonCodeCategoryRow,
  type ReasonCodeAdminRow,
  type CreateReasonCodeInput,
} from './infrastructure/reason-code-admin.repository'

export {
  listCoffeeTypes,
  createCoffeeType,
  setCoffeeTypeActive,
  listCoffeeGrades,
  createCoffeeGrade,
  setCoffeeGradeActive,
  listScreenSizes,
  createScreenSize,
  setScreenSizeActive,
  listCertifications,
  createCertification,
  setCertificationActive,
  listHarvestYears,
  createHarvestYear,
  setHarvestYearActive,
  type CoffeeTypeRow,
  type CreateCoffeeTypeInput,
  type CoffeeGradeRow,
  type CreateCoffeeGradeInput,
  type ScreenSizeRow,
  type CreateScreenSizeInput,
  type CertificationRow,
  type CreateCertificationInput,
  type HarvestYearRow,
  type CreateHarvestYearInput,
} from './infrastructure/coffee-master-data.repository'

export {
  listBagTypesWithVersions,
  listVersionsForBagType,
  createBagType,
  addBagTypeVersion,
  setBagTypeActive,
  type BagTypeRow,
  type BagTypeVersionRow,
  type CreateBagTypeInput,
  type AddBagTypeVersionInput,
} from './infrastructure/bag-type-admin.repository'
