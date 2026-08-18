/**
 * Schema barrel — the only import surface for table definitions.
 *
 * One file per bounded area, not one giant schema.ts. Phase 2 adds files
 * (contract.ts, billing.ts); it does not edit Phase 1 files except to add a
 * foreign key, which is additive.
 *
 * Export order follows the dependency order, which is also the migration order: a table
 * cannot reference one declared after it.
 *
 * docs/architecture/02-project-structure.md §2.6
 */

// Foundation
export * from './audit'
export * from './identity'
export * from './administration'
export * from './master-data'
export * from './reference'
export * from './files'

// Physical and commercial structure
export * from './warehouse'
export * from './customer'
export * from './onboarding'

// The consignment spine and the ledger it hangs on
export * from './consignment'
export * from './stock'
export * from './kesha'

// The operational chain, in the order coffee moves through it
export * from './inbound'
export * from './scheduling'
export * from './processing'
export * from './acceptance'
export * from './dispatch'
export * from './labour'

// Cross-cutting delivery
export * from './notification'
export * from './printing'

// Phase 2
export * from './workflow' // M03
export * from './contract' // M10
export * from './billing' // M19 / M20

// Phase 3:
// export * from './ai'              // M24–M28
