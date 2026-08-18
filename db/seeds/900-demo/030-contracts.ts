import { sql } from 'drizzle-orm'
import { demoId, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M10 contracts and tariff lines. Covers DRAFT / ACTIVE / EXPIRED / TERMINATED, plus the
 * branch standard tariff (`contract_id is null`) that a customer with no contract at all
 * falls back to — Limu Kossa (closed) is left with neither, on purpose, as the empty state.
 */

const SERVICE_LINES: ReadonlyArray<{ code: string; uom: string; rate: string }> = [
  { code: 'UNLOADING', uom: 'PER_KESHA', rate: '15.00' },
  { code: 'STORAGE_PER_DAY', uom: 'PER_KG', rate: '0.20' },
  { code: 'PROCESSING_PER_KG', uom: 'PER_KG', rate: '1.50' },
  { code: 'LOADING', uom: 'PER_KESHA', rate: '15.00' },
]

interface ContractSeed {
  seed: string
  customerSeed: string
  reference: string
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED'
  fromDaysAgo: number
  toDaysAgo?: number
  rateMultiplier: number
}

const CONTRACTS: readonly ContractSeed[] = [
  {
    seed: 'contract:abyssinia',
    customerSeed: 'customer:abyssinia-highland',
    reference: 'CTR-2026-000001',
    status: 'ACTIVE',
    fromDaysAgo: 200,
    rateMultiplier: 0.9,
  },
  {
    seed: 'contract:oromia-union',
    customerSeed: 'customer:oromia-coffee-union',
    reference: 'CTR-2026-000002',
    status: 'ACTIVE',
    fromDaysAgo: 180,
    rateMultiplier: 0.85,
  },
  {
    seed: 'contract:yirgacheffe',
    customerSeed: 'customer:yirgacheffe-farmers',
    reference: 'CTR-2026-000003',
    status: 'ACTIVE',
    fromDaysAgo: 150,
    rateMultiplier: 1.0,
  },
  {
    seed: 'contract:sidama-bensa',
    customerSeed: 'customer:sidama-bensa-supplier',
    reference: 'CTR-2026-000004',
    status: 'DRAFT',
    fromDaysAgo: 10,
    rateMultiplier: 1.0,
  },
  {
    seed: 'contract:kaffa-forest',
    customerSeed: 'customer:kaffa-forest-trading',
    reference: 'CTR-2026-000005',
    status: 'ACTIVE',
    fromDaysAgo: 120,
    rateMultiplier: 0.95,
  },
  {
    seed: 'contract:guji-highlands',
    customerSeed: 'customer:guji-highlands',
    reference: 'CTR-2026-000006',
    status: 'EXPIRED',
    fromDaysAgo: 400,
    toDaysAgo: 40,
    rateMultiplier: 1.0,
  },
  {
    seed: 'contract:tesfaye',
    customerSeed: 'customer:tesfaye-bekele',
    reference: 'CTR-2026-000007',
    status: 'TERMINATED',
    fromDaysAgo: 300,
    toDaysAgo: 60,
    rateMultiplier: 1.05,
  },
  // Limu Kossa Cooperative Union (CLOSED) gets no contract at all — the empty state.
]

export async function seedContracts(
  ctx: SeedContext,
  branchId: string,
  actorId: string,
  customerIdBySeed: Map<string, string>,
): Promise<void> {
  const { log } = ctx

  // Branch standard tariff — contract_id null, what a customer with no negotiated contract
  // (or no contract at all) is priced against.
  for (const line of SERVICE_LINES) {
    await ctx.tx.execute(sql`
      insert into public.tariff_line
        (id, contract_id, branch_id, service_code, uom, rate_amount, effective_from, created_by)
      values (${demoId(`tariff:standard:${line.code}`)}, null, ${branchId}, ${line.code},
              ${line.uom}, ${line.rate}, date '2026-01-01', ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`branch standard tariff: ${SERVICE_LINES.length} service lines`)

  let contractCount = 0
  for (const c of CONTRACTS) {
    const customerId = customerIdBySeed.get(c.customerSeed)
    if (!customerId) continue

    const id = demoId(c.seed)
    const effectiveFrom = daysAgo(c.fromDaysAgo)
    const effectiveTo = c.toDaysAgo !== undefined ? daysAgo(c.toDaysAgo) : null

    await ctx.tx.execute(sql`
      insert into public.contract
        (id, reference, customer_id, branch_id, status, effective_from, effective_to,
         free_storage_days, payment_terms_days, credit_limit_amount, terminated_at,
         terminated_reason, notes, created_by)
      values (${id}, ${c.reference}, ${customerId}, ${branchId}, ${c.status}, ${effectiveFrom},
              ${effectiveTo}, 14, 30, '2000000.00',
              ${c.status === 'TERMINATED' ? new Date(`${effectiveTo}T12:00:00+03:00`) : null},
              ${c.status === 'TERMINATED' ? 'Customer requested early termination' : null},
              ${c.status === 'DRAFT' ? 'Awaiting signature from customer representative.' : null},
              ${actorId})
      on conflict (id) do nothing
    `)
    contractCount += 1

    for (const line of SERVICE_LINES) {
      const rate = (parseFloat(line.rate) * c.rateMultiplier).toFixed(2)
      await ctx.tx.execute(sql`
        insert into public.tariff_line
          (id, contract_id, branch_id, service_code, uom, rate_amount, effective_from,
           negotiation_reason, created_by)
        values (${demoId(`tariff:${c.seed}:${line.code}`)}, ${id}, ${branchId}, ${line.code},
                ${line.uom}, ${rate}, ${effectiveFrom}, 'Negotiated volume discount', ${actorId})
        on conflict (id) do nothing
      `)
    }
  }
  log(`contracts: ${contractCount} (DRAFT/ACTIVE x3/EXPIRED/TERMINATED); Limu Kossa has none`)
}
