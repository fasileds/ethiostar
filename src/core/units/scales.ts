/**
 * Decimal scales, mirrored exactly by the database column definitions.
 *
 * Duplicated here rather than imported from @config/constants because the kernel depends on
 * nothing inside src/ (docs/architecture/01-principles-and-layering.md §1.3). A unit test
 * asserts the two agree, so they cannot drift.
 */

/** numeric(14,3) — kilograms to the gram. */
export const WEIGHT_DECIMAL_PLACES = 3

/** numeric(14,2) — money to the cent. */
export const MONEY_DECIMAL_PLACES = 2

/** numeric(6,3) — percentages, e.g. yield and mass-balance variance. */
export const PERCENT_DECIMAL_PLACES = 3
