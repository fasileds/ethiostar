import { sql } from 'drizzle-orm'
import { demoId, addis, daysAgo, ref, postStockMovement, postKeshaMovement } from './util'
import type { SeedContext } from '../types'
import type { OrgRefs } from './040-org-master'

/**
 * The operational spine: M11 inbound through M17 dispatch, for one consignment at a time.
 *
 * Kept as ONE file rather than split further, deliberately: a consignment's lot ids, job
 * order ids and stock-ledger correlation ids thread through every stage from the goods
 * receipt to the dispatch note, and splitting that thread across five files (one per
 * module) would mean passing the same half-built object through five signatures for no
 * reader benefit — the module boundary that matters here is "does this table belong to
 * M11/13/14/15/16/17", which every insert below is commented with, not "which file is it
 * physically in". Labour, billing/printing and notification/files — which do NOT share
 * this thread — get their own files (100/110/120).
 *
 * Each scenario is inserted DIRECTLY at its target consignment status (the transition-guard
 * trigger only fires `BEFORE UPDATE OF status`, never on INSERT — see migration 0011), with
 * a plausible synthetic `consignment_status_history` trail added alongside for the timeline
 * UI. That sidesteps walking every intermediate legal transition by hand for twelve
 * consignments, while still producing every table a "REQUESTED" vs "CLOSED" vs "CANCELLED"
 * consignment's read model expects to find.
 */

const TIER = {
  REQUESTED: 0,
  ACCEPTED: 1,
  RECEIVED: 2,
  STORED: 3,
  SCHEDULED: 4,
  IN_PROCESS: 5,
  PROCESSED: 6,
  ACCEPTED_BY_CUSTOMER: 7,
  RELEASE_REQUESTED: 8,
  DISPATCHED: 9,
  CLOSED: 10,
} as const

type ConsignmentStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'RECEIVED'
  | 'STORED'
  | 'SCHEDULED'
  | 'IN_PROCESS'
  | 'PROCESSED'
  | 'ACCEPTED_BY_CUSTOMER'
  | 'RELEASE_REQUESTED'
  | 'DISPATCHED'
  | 'CLOSED'
  | 'CANCELLED'

interface Scenario {
  seed: string
  n: number
  customerSeed: string
  finalStatus: ConsignmentStatus
  coffeeType: 'WASHED' | 'NATURAL' | 'SEMI_WASHED'
  coffeeGrade: string
  regionCode: string
  warehouse: 'main' | 'bole'
  declaredKg: number
  declaredKesha: number
  arrivalDaysAgo: number
  /** Only for scenarios that reach PROCESSED+: force an exception mass-balance instead of
   *  a clean balance, for the variety a mass-balance report needs. */
  massBalanceException?: boolean
}

const SCENARIOS: readonly Scenario[] = [
  {
    seed: 'cns-abyssinia-closed',
    n: 1,
    customerSeed: 'customer:abyssinia-highland',
    finalStatus: 'CLOSED',
    coffeeType: 'WASHED',
    coffeeGrade: 'G1',
    regionCode: 'SIDAMA',
    warehouse: 'main',
    declaredKg: 12000,
    declaredKesha: 200,
    arrivalDaysAgo: 150,
  },
  {
    seed: 'cns-abyssinia-dispatched',
    n: 2,
    customerSeed: 'customer:abyssinia-highland',
    finalStatus: 'DISPATCHED',
    coffeeType: 'WASHED',
    coffeeGrade: 'G2',
    regionCode: 'SIDAMA',
    warehouse: 'main',
    declaredKg: 9000,
    declaredKesha: 150,
    arrivalDaysAgo: 90,
  },
  {
    seed: 'cns-abyssinia-release-requested',
    n: 3,
    customerSeed: 'customer:abyssinia-highland',
    finalStatus: 'RELEASE_REQUESTED',
    coffeeType: 'NATURAL',
    coffeeGrade: 'G3',
    regionCode: 'OROMIA',
    warehouse: 'main',
    declaredKg: 6000,
    declaredKesha: 100,
    arrivalDaysAgo: 60,
  },
  {
    seed: 'cns-oromia-accepted-by-customer',
    n: 4,
    customerSeed: 'customer:oromia-coffee-union',
    finalStatus: 'ACCEPTED_BY_CUSTOMER',
    coffeeType: 'WASHED',
    coffeeGrade: 'G1',
    regionCode: 'OROMIA',
    warehouse: 'main',
    declaredKg: 15000,
    declaredKesha: 250,
    arrivalDaysAgo: 50,
  },
  {
    seed: 'cns-tesfaye-processed',
    n: 5,
    customerSeed: 'customer:tesfaye-bekele',
    finalStatus: 'PROCESSED',
    coffeeType: 'NATURAL',
    coffeeGrade: 'G4',
    regionCode: 'OROMIA',
    warehouse: 'bole',
    declaredKg: 3000,
    declaredKesha: 50,
    arrivalDaysAgo: 35,
    massBalanceException: true,
  },
  {
    seed: 'cns-oromia-in-process',
    n: 6,
    customerSeed: 'customer:oromia-coffee-union',
    finalStatus: 'IN_PROCESS',
    coffeeType: 'WASHED',
    coffeeGrade: 'G2',
    regionCode: 'OROMIA',
    warehouse: 'main',
    declaredKg: 8000,
    declaredKesha: 133,
    arrivalDaysAgo: 25,
  },
  {
    seed: 'cns-yirgacheffe-scheduled',
    n: 7,
    customerSeed: 'customer:yirgacheffe-farmers',
    finalStatus: 'SCHEDULED',
    coffeeType: 'WASHED',
    coffeeGrade: 'G1',
    regionCode: 'SIDAMA',
    warehouse: 'main',
    declaredKg: 5000,
    declaredKesha: 83,
    arrivalDaysAgo: 20,
  },
  {
    seed: 'cns-yirgacheffe-stored',
    n: 8,
    customerSeed: 'customer:yirgacheffe-farmers',
    finalStatus: 'STORED',
    coffeeType: 'WASHED',
    coffeeGrade: 'G2',
    regionCode: 'SIDAMA',
    warehouse: 'main',
    declaredKg: 4500,
    declaredKesha: 75,
    arrivalDaysAgo: 15,
  },
  {
    seed: 'cns-sidama-bensa-received',
    n: 9,
    customerSeed: 'customer:sidama-bensa-supplier',
    finalStatus: 'RECEIVED',
    coffeeType: 'SEMI_WASHED',
    coffeeGrade: 'G3',
    regionCode: 'SIDAMA',
    warehouse: 'bole',
    declaredKg: 3600,
    declaredKesha: 60,
    arrivalDaysAgo: 8,
  },
  {
    seed: 'cns-kaffa-accepted',
    n: 10,
    customerSeed: 'customer:kaffa-forest-trading',
    finalStatus: 'ACCEPTED',
    coffeeType: 'WASHED',
    coffeeGrade: 'G1',
    regionCode: 'SNNPR',
    warehouse: 'main',
    declaredKg: 7000,
    declaredKesha: 117,
    arrivalDaysAgo: 4,
  },
  {
    seed: 'cns-kaffa-requested',
    n: 11,
    customerSeed: 'customer:kaffa-forest-trading',
    finalStatus: 'REQUESTED',
    coffeeType: 'WASHED',
    coffeeGrade: 'UG',
    regionCode: 'SNNPR',
    warehouse: 'main',
    declaredKg: 2000,
    declaredKesha: 33,
    arrivalDaysAgo: 1,
  },
  {
    seed: 'cns-guji-cancelled',
    n: 12,
    customerSeed: 'customer:guji-highlands',
    finalStatus: 'CANCELLED',
    coffeeType: 'NATURAL',
    coffeeGrade: 'G4',
    regionCode: 'OROMIA',
    warehouse: 'main',
    declaredKg: 4000,
    declaredKesha: 67,
    arrivalDaysAgo: 100,
  },
]

async function codeMap(ctx: SeedContext, table: string): Promise<Record<string, string>> {
  const rows = (await ctx.tx.execute(
    sql`select code, id from ${sql.raw(`public."${table}"`)}`,
  )) as unknown as Array<{ code: string; id: string }>
  const map: Record<string, string> = {}
  for (const r of rows) map[r.code] = r.id
  return map
}

export async function seedPipeline(
  ctx: SeedContext,
  branchId: string,
  org: OrgRefs,
  customerIdBySeed: Map<string, string>,
  userIdBySeed: Map<string, string>,
): Promise<void> {
  const { log } = ctx

  const coffeeTypes = await codeMap(ctx, 'coffee_type')
  const coffeeGrades = await codeMap(ctx, 'coffee_grade')
  const regions = await codeMap(ctx, 'region')
  const bagTypes = await codeMap(ctx, 'bag_type')
  const outputs = await codeMap(ctx, 'output_classification')
  const reasons = await codeMap(ctx, 'reason_code')

  const storeKeeperId = userIdBySeed.get('user:store-keeper')!
  const csoId = userIdBySeed.get('user:cso')!
  const opsManagerId = userIdBySeed.get('user:ops-manager')!
  const productionOperatorId = userIdBySeed.get('user:production-operator')!
  const gateOfficerId = userIdBySeed.get('user:gate-officer')!

  // Two harvest years — missing from the base reference seed, needed for realistic lots.
  const hyPrevId = demoId('harvest_year:2024')
  const hyCurrId = demoId('harvest_year:2025')
  await ctx.tx.execute(sql`
    insert into public.harvest_year (id, code, name_en, starts_on, ends_on, is_current, created_by)
    values (${hyPrevId}, 'HY2024', '2024/25', date '2024-10-01', date '2025-09-30', false, ${opsManagerId})
    on conflict (code) do nothing
  `)
  await ctx.tx.execute(sql`
    insert into public.harvest_year (id, code, name_en, starts_on, ends_on, is_current, created_by)
    values (${hyCurrId}, 'HY2025', '2025/26', date '2025-10-01', date '2026-09-30', true, ${opsManagerId})
    on conflict (code) do nothing
  `)

  let bagCounter = 0
  for (const s of SCENARIOS) {
    bagCounter += 1
    await runScenario(ctx, s, {
      branchId,
      org,
      customerId: customerIdBySeed.get(s.customerSeed)!,
      storeKeeperId,
      csoId,
      opsManagerId,
      productionOperatorId,
      gateOfficerId,
      coffeeTypes,
      coffeeGrades,
      regions,
      bagTypes,
      outputs,
      reasons,
      harvestYearId: hyCurrId,
      bagCounter,
    })
  }

  log(`consignments: ${SCENARIOS.length} spanning every lifecycle status incl. CANCELLED`)
}

interface RunCtx {
  branchId: string
  org: OrgRefs
  customerId: string
  storeKeeperId: string
  csoId: string
  opsManagerId: string
  productionOperatorId: string
  gateOfficerId: string
  coffeeTypes: Record<string, string>
  coffeeGrades: Record<string, string>
  regions: Record<string, string>
  bagTypes: Record<string, string>
  outputs: Record<string, string>
  reasons: Record<string, string>
  harvestYearId: string
  bagCounter: number
}

async function runScenario(ctx: SeedContext, s: Scenario, r: RunCtx): Promise<void> {
  const tier = s.finalStatus === 'CANCELLED' ? -1 : TIER[s.finalStatus]
  const consignmentId = demoId(`consignment:${s.seed}`)
  const reference = ref('CNS', 2026, s.n)
  const section = s.warehouse === 'main' ? r.org.sectionId.mainA1 : r.org.sectionId.boleB1
  const lossSection =
    s.warehouse === 'main' ? r.org.sectionId.mainLoss : r.org.sectionId.boleLoss
  const bagTypeId = r.bagTypes['JUTE_60']
  const coffeeTypeId = r.coffeeTypes[s.coffeeType]
  const coffeeGradeId = r.coffeeGrades[s.coffeeGrade]
  const regionId = r.regions[s.regionCode]
  const correlationId = demoId(`correlation:${s.seed}`)

  const arrivalOn = daysAgo(s.arrivalDaysAgo)
  const requestedAt = addis(daysAgo(s.arrivalDaysAgo + 5), 9, 0)
  const receivedAt = addis(arrivalOn, 11, 30)

  const receivedKg = s.finalStatus === 'REQUESTED' ? null : (s.declaredKg - 15).toFixed(3)
  const receivedKesha = s.finalStatus === 'REQUESTED' ? null : s.declaredKesha

  // ── consignment header, inserted directly at its final status ─────────────
  await ctx.tx.execute(sql`
    insert into public.consignment
      (id, reference, branch_id, customer_id, status, coffee_type_id, origin_region_id,
       harvest_year_id, declared_quantity_kg, declared_kesha_count, received_quantity_kg,
       received_kesha_count, expected_arrival_on, received_at, storage_start_date, closed_at,
       created_by)
    values
      (${consignmentId}, ${reference}, ${r.branchId}, ${r.customerId}, ${s.finalStatus},
       ${coffeeTypeId}, ${regionId}, ${r.harvestYearId}, ${s.declaredKg.toFixed(3)},
       ${s.declaredKesha}, ${tier >= TIER.RECEIVED ? receivedKg : null},
       ${tier >= TIER.RECEIVED ? receivedKesha : null}, ${arrivalOn},
       ${tier >= TIER.RECEIVED ? receivedAt : null}, ${tier >= TIER.STORED ? arrivalOn : null},
       ${s.finalStatus === 'CLOSED' ? addis(daysAgo(s.arrivalDaysAgo - 3), 17, 0) : null},
       ${r.csoId})
    on conflict (id) do nothing
  `)

  await ctx.tx.execute(sql`
    insert into public.consignment_status_history
      (id, consignment_id, from_status, to_status, occurred_at, actor_id, reason)
    values (${demoId(`cns_hist:${s.seed}:0`)}, ${consignmentId}, null, 'REQUESTED',
            ${requestedAt}, ${r.csoId}, 'Delivery request submitted')
    on conflict (id) do nothing
  `)
  if (s.finalStatus !== 'REQUESTED') {
    await ctx.tx.execute(sql`
      insert into public.consignment_status_history
        (id, consignment_id, from_status, to_status, occurred_at, actor_id, reason)
      values (${demoId(`cns_hist:${s.seed}:1`)}, ${consignmentId}, 'REQUESTED', ${s.finalStatus},
              ${s.finalStatus === 'CANCELLED' ? addis(daysAgo(s.arrivalDaysAgo + 2), 10, 0) : receivedAt},
              ${r.opsManagerId},
              ${s.finalStatus === 'CANCELLED' ? 'Customer withdrew the request' : 'Progressed through the operational pipeline'})
      on conflict (id) do nothing
    `)
  }

  // ── M11: delivery request, gate pass, weighbridge, goods receipt ──────────
  const deliveryRequestId = demoId(`delivery_request:${s.seed}`)
  const drStatus =
    s.finalStatus === 'CANCELLED'
      ? 'REJECTED'
      : s.finalStatus === 'REQUESTED'
        ? 'SUBMITTED'
        : tier >= TIER.RECEIVED
          ? 'RECEIVED'
          : 'APPROVED'

  await ctx.tx.execute(sql`
    insert into public.delivery_request
      (id, reference, branch_id, customer_id, status, coffee_type_id, coffee_grade_id,
       harvest_year_id, bag_type_id, declared_quantity_kg, declared_kesha_count,
       expected_arrival_on, vehicle_plate, driver_name, driver_phone, submitted_at,
       approved_by, approved_at, rejection_reason, consignment_id, created_by)
    values
      (${deliveryRequestId}, ${ref('DR', 2026, s.n)}, ${r.branchId}, ${r.customerId}, ${drStatus},
       ${coffeeTypeId}, ${coffeeGradeId}, ${r.harvestYearId}, ${bagTypeId},
       ${s.declaredKg.toFixed(3)}, ${s.declaredKesha}, ${arrivalOn},
       ${`ET-3-A${10000 + r.bagCounter}`}, 'Contract Driver', '+251911000000', ${requestedAt},
       ${drStatus === 'REJECTED' ? null : r.opsManagerId},
       ${drStatus === 'REJECTED' ? null : addis(daysAgo(s.arrivalDaysAgo + 3), 14, 0)},
       ${drStatus === 'REJECTED' ? 'Storage capacity unavailable for the requested window' : null},
       ${s.finalStatus === 'REQUESTED' ? null : consignmentId}, ${r.csoId})
    on conflict (id) do nothing
  `)

  if (tier < TIER.ACCEPTED) return // REQUESTED / CANCELLED go no further downstream

  // Capacity reservation for anything that got approved.
  await ctx.tx.execute(sql`
    insert into public.capacity_reservation
      (id, location_id, delivery_request_id, customer_id, quantity_kg, kesha_count, status,
       expires_at, consumed_at, created_by)
    values
      (${demoId(`reservation:${s.seed}`)}, ${section}, ${deliveryRequestId}, ${r.customerId},
       ${s.declaredKg.toFixed(3)}, ${s.declaredKesha},
       ${tier >= TIER.RECEIVED ? 'CONSUMED' : 'ACTIVE'},
       ${addis(daysAgo(s.arrivalDaysAgo - 7), 23, 59)},
       ${tier >= TIER.RECEIVED ? receivedAt : null}, ${r.opsManagerId})
    on conflict (id) do nothing
  `)

  if (tier < TIER.RECEIVED) return

  // Gate pass, used at the gate.
  await ctx.tx.execute(sql`
    insert into public.gate_pass
      (id, reference, delivery_request_id, scan_token, valid_on, valid_until, vehicle_plate,
       driver_name, status, used_at, created_by)
    values
      (${demoId(`gate_pass:${s.seed}`)}, ${ref('GP', 2026, s.n)}, ${deliveryRequestId},
       ${demoId(`gate_token:${s.seed}`)}, ${arrivalOn}, ${addis(arrivalOn, 23, 59)},
       ${`ET-3-A${10000 + r.bagCounter}`}, 'Contract Driver', 'USED', ${receivedAt}, ${r.gateOfficerId})
    on conflict (id) do nothing
  `)

  // Weighbridge ticket.
  const grossKg = (Number(receivedKg) + 8000).toFixed(3)
  const weighbridgeId = demoId(`weighbridge:${s.seed}`)
  await ctx.tx.execute(sql`
    insert into public.weighbridge_ticket
      (id, ticket_no, delivery_request_id, vehicle_plate, gross_weight_kg, tare_weight_kg,
       weighed_in_at, weighed_out_at, capture_method, created_by)
    values
      (${weighbridgeId}, ${ref('WB', 2026, s.n)}, ${deliveryRequestId},
       ${`ET-3-A${10000 + r.bagCounter}`}, ${grossKg}, '8000.000', ${addis(arrivalOn, 10, 45)},
       ${addis(arrivalOn, 11, 15)}, 'MANUAL', ${r.storeKeeperId})
    on conflict (id) do nothing
  `)

  // Goods receipt: the moment stock is created.
  const receiptId = demoId(`goods_receipt:${s.seed}`)
  const varianceKg = (Number(receivedKg) - s.declaredKg).toFixed(3)
  await ctx.tx.execute(sql`
    insert into public.goods_receipt
      (id, reference, branch_id, consignment_id, delivery_request_id, customer_id, status,
       weighbridge_ticket_id, vehicle_plate, driver_name, received_quantity_kg,
       received_kesha_count, declared_quantity_kg, declared_kesha_count, variance_kg,
       variance_pct, tolerance_applied_pct, location_id, occurred_at, received_by,
       customer_rep_name, posted_at, created_by)
    values
      (${receiptId}, ${ref('GRN', 2026, s.n)}, ${r.branchId}, ${consignmentId},
       ${deliveryRequestId}, ${r.customerId}, 'POSTED', ${weighbridgeId},
       ${`ET-3-A${10000 + r.bagCounter}`}, 'Contract Driver', ${receivedKg}, ${receivedKesha},
       ${s.declaredKg.toFixed(3)}, ${s.declaredKesha}, ${varianceKg}, '0.500', '0.500',
       ${section}, ${receivedAt}, ${r.storeKeeperId}, 'Customer Warehouse Representative',
       ${addis(arrivalOn, 12, 0)}, ${r.storeKeeperId})
    on conflict (id) do nothing
  `)

  const lotId = demoId(`lot:${s.seed}:received`)
  await ctx.tx.execute(sql`
    insert into public.lot
      (id, reference, consignment_id, customer_id, status, coffee_type_id, coffee_grade_id,
       bag_type_id, initial_quantity_kg, initial_kesha_count, storage_start_date, created_by)
    values
      (${lotId}, ${ref('LOT', 2026, s.n)}, ${consignmentId}, ${r.customerId},
       ${tier >= TIER.IN_PROCESS ? 'CONSUMED' : 'IN_STORE'}, ${coffeeTypeId}, ${coffeeGradeId},
       ${bagTypeId}, ${receivedKg}, ${receivedKesha}, ${arrivalOn}, ${r.storeKeeperId})
    on conflict (id) do nothing
  `)

  await ctx.tx.execute(sql`
    insert into public.goods_receipt_line
      (id, receipt_id, line_no, bag_type_id, coffee_type_id, coffee_grade_id, quantity_kg,
       kesha_count, location_id, lot_id, created_by)
    values
      (${demoId(`grn_line:${s.seed}`)}, ${receiptId}, 1, ${bagTypeId}, ${coffeeTypeId},
       ${coffeeGradeId}, ${receivedKg}, ${receivedKesha}, ${section}, ${lotId}, ${r.storeKeeperId})
    on conflict (id) do nothing
  `)

  await postStockMovement(ctx, {
    seed: `${s.seed}:receipt`,
    occurredAt: receivedAt,
    movementType: 'RECEIPT',
    lotId,
    customerId: r.customerId,
    consignmentId,
    locationId: section,
    quantityKg: receivedKg!,
    keshaCount: receivedKesha!,
    bagTypeId,
    sourceType: 'goods_receipt',
    sourceId: receiptId,
    actorId: r.storeKeeperId,
    correlationId,
  })

  await postKeshaMovement(ctx, {
    seed: `${s.seed}:kesha-received`,
    occurredAt: receivedAt,
    branchId: r.branchId,
    customerId: r.customerId,
    consignmentId,
    bagTypeId,
    locationId: section,
    movementType: 'RECEIVED_FULL',
    keshaDelta: receivedKesha!,
    sourceType: 'goods_receipt',
    sourceId: receiptId,
    actorId: r.storeKeeperId,
    balanceEffect: { heldFull: receivedKesha! },
  })

  await ctx.tx.execute(sql`
    insert into public.quality_inspection
      (id, receipt_id, consignment_id, moisture_pct, defect_count, appearance, verdict,
       inspector_note, inspected_by, inspected_at, created_by)
    values
      (${demoId(`inspection:${s.seed}`)}, ${receiptId}, ${consignmentId}, '11.200', 4, 'GOOD',
       'PASS', 'Within expected range for the declared grade.', ${r.storeKeeperId}, ${receivedAt},
       ${r.storeKeeperId})
    on conflict (id) do nothing
  `)

  if (tier < TIER.STORED) return

  await ctx.tx.execute(sql`
    insert into public.lot_placement (lot_id, location_id, placed_at, created_by)
    values (${lotId}, ${section}, ${receivedAt}, ${r.storeKeeperId})
    on conflict (lot_id, location_id) do nothing
  `)

  if (tier < TIER.SCHEDULED) return

  // ── M14: appointment ────────────────────────────────────────────────────
  const machineId = r.org.machineId.sorter
  const scheduledOn = daysAgo(Math.max(s.arrivalDaysAgo - 5, 0))
  const appointmentId = demoId(`appointment:${s.seed}`)
  const appointmentStatus = tier >= TIER.IN_PROCESS ? 'IN_PROGRESS' : 'CONFIRMED'
  await ctx.tx.execute(sql`
    insert into public.appointment
      (id, reference, branch_id, customer_id, consignment_id, machine_id, scheduled_on,
       scheduled_start_at, scheduled_end_at, sequence_no, planned_quantity_kg, status,
       confirmed_at, started_at, created_by)
    values
      (${appointmentId}, ${ref('APT', 2026, s.n)}, ${r.branchId}, ${r.customerId}, ${consignmentId},
       ${machineId}, ${scheduledOn}, ${addis(scheduledOn, 8, 0)}, ${addis(scheduledOn, 14, 0)},
       ${s.n}, ${receivedKg}, ${appointmentStatus}, ${addis(scheduledOn, 7, 0)},
       ${tier >= TIER.IN_PROCESS ? addis(scheduledOn, 8, 5) : null}, ${r.opsManagerId})
    on conflict (id) do nothing
  `)

  const processingRequestId = demoId(`processing_request:${s.seed}`)
  await ctx.tx.execute(sql`
    insert into public.processing_request
      (id, reference, branch_id, customer_id, consignment_id, status, service_type,
       requested_quantity_kg, submitted_at, approved_by, approved_at, appointment_id, created_by)
    values
      (${processingRequestId}, ${ref('PR', 2026, s.n)}, ${r.branchId}, ${r.customerId},
       ${consignmentId}, 'SCHEDULED', 'SORTING', ${receivedKg}, ${addis(scheduledOn, 7, 30)},
       ${r.opsManagerId}, ${addis(scheduledOn, 7, 45)}, ${appointmentId}, ${r.csoId})
    on conflict (id) do nothing
  `)

  if (tier < TIER.IN_PROCESS) return

  // ── M15: job order, inputs, outputs, mass balance ──────────────────────
  const jobOrderId = demoId(`job_order:${s.seed}`)
  // ck_job_order__closed_is_balanced requires mass_balance_status whenever status = CLOSED,
  // and that isn't computed until the mass-balance UPDATE further down (it depends on the
  // output/loss lines, which don't exist yet). So every job starts IN_PROGRESS here; the
  // tier >= PROCESSED branch promotes it to CLOSED in the same statement that sets
  // mass_balance_status.
  const startedAt = addis(scheduledOn, 8, 10)
  const inputKg = receivedKg!

  await ctx.tx.execute(sql`
    insert into public.job_order
      (id, reference, branch_id, customer_id, consignment_id, processing_request_id,
       appointment_id, machine_id, status, service_type, planned_input_kg, actual_input_kg,
       scheduled_start_at, started_at, supervisor_id, created_by)
    values
      (${jobOrderId}, ${ref('JOB', 2026, s.n)}, ${r.branchId}, ${r.customerId}, ${consignmentId},
       ${processingRequestId}, ${appointmentId}, ${machineId}, 'IN_PROGRESS', 'SORTING',
       ${inputKg}, ${inputKg}, ${addis(scheduledOn, 8, 0)}, ${startedAt}, ${r.opsManagerId},
       ${r.productionOperatorId})
    on conflict (id) do nothing
  `)

  await ctx.tx.execute(sql`
    insert into public.job_order_input
      (id, job_order_id, line_no, lot_id, location_id, quantity_kg, coffee_type_id,
       coffee_grade_id, stock_movement_id, issued_at, created_by)
    values
      (${demoId(`job_input:${s.seed}`)}, ${jobOrderId}, 1, ${lotId}, ${section}, ${inputKg},
       ${coffeeTypeId}, ${coffeeGradeId}, null, ${startedAt}, ${r.productionOperatorId})
    on conflict (id) do nothing
  `)

  await postStockMovement(ctx, {
    seed: `${s.seed}:issue`,
    occurredAt: startedAt,
    movementType: 'ISSUE_TO_JOB',
    lotId,
    customerId: r.customerId,
    consignmentId,
    locationId: section,
    quantityKg: `-${inputKg}`,
    keshaCount: -(receivedKesha ?? 0),
    bagTypeId,
    sourceType: 'job_order',
    sourceId: jobOrderId,
    actorId: r.productionOperatorId,
    correlationId,
  })

  if (tier < TIER.PROCESSED) return

  // Four output lines: the primary (export-ready) classification plus three rejects, with
  // an explicit loss line — loss is a DESTINATION, not a second withdrawal (docs/adr §3.4).
  const input = Number(inputKg)
  const lossPct = s.massBalanceException ? 0.025 : 0.01
  const splits: Array<{ code: string; pct: number }> = [
    { code: 'APPROVED', pct: 0.8 },
    { code: 'C_GRADE', pct: 0.11 },
    { code: 'GRAVITY', pct: 0.05 },
    { code: 'COLOUR_SORTER', pct: 0.03 },
  ]
  const outputTotalPct = splits.reduce((sum, x) => sum + x.pct, 0)
  const scaledPcts = splits.map((x) => x.pct * (1 - lossPct) * (1 / outputTotalPct))

  let outputSum = 0
  let approvedLotQty = 0
  const completedAt = addis(scheduledOn, 13, 30)
  for (const [i, split] of splits.entries()) {
    const pct = scaledPcts[i]!
    const qty = Number((input * pct).toFixed(3))
    outputSum += qty
    if (split.code === 'APPROVED') approvedLotQty = qty
    const outputLotId = demoId(`lot:${s.seed}:output:${split.code}`)
    const outputSection = split.code === 'APPROVED' ? section : section

    await ctx.tx.execute(sql`
      insert into public.lot
        (id, reference, consignment_id, customer_id, status, coffee_type_id, coffee_grade_id,
         bag_type_id, output_classification_id, initial_quantity_kg, initial_kesha_count,
         storage_start_date, created_by)
      values
        (${outputLotId}, ${ref('LOT', 2026, s.n * 10 + i + 1)}, ${consignmentId}, ${r.customerId},
         'PRODUCED', ${coffeeTypeId}, ${coffeeGradeId}, ${bagTypeId}, ${r.outputs[split.code]},
         ${qty.toFixed(3)}, ${Math.max(1, Math.round(qty / 60))}, ${scheduledOn},
         ${r.productionOperatorId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.lot_lineage (parent_lot_id, child_lot_id, job_order_id, created_at)
      values (${lotId}, ${outputLotId}, ${jobOrderId}, ${completedAt})
      on conflict (parent_lot_id, child_lot_id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.job_order_output
        (id, job_order_id, line_no, classification_id, is_loss, quantity_kg, kesha_count,
         percent_of_input, lot_id, location_id, coffee_grade_id, produced_at, created_by)
      values
        (${demoId(`job_output:${s.seed}:${split.code}`)}, ${jobOrderId}, ${i + 1},
         ${r.outputs[split.code]}, false, ${qty.toFixed(3)}, ${Math.max(1, Math.round(qty / 60))},
         ${(pct * 100).toFixed(3)}, ${outputLotId}, ${outputSection}, ${coffeeGradeId},
         ${completedAt}, ${r.productionOperatorId})
      on conflict (id) do nothing
    `)

    await postStockMovement(ctx, {
      seed: `${s.seed}:output:${split.code}`,
      occurredAt: completedAt,
      movementType: 'OUTPUT_FROM_JOB',
      lotId: outputLotId,
      customerId: r.customerId,
      consignmentId,
      locationId: outputSection,
      quantityKg: qty.toFixed(3),
      keshaCount: Math.max(1, Math.round(qty / 60)),
      bagTypeId,
      sourceType: 'job_order',
      sourceId: jobOrderId,
      actorId: r.productionOperatorId,
      correlationId,
    })
  }

  const lossKg = Number((input - outputSum).toFixed(3))
  await ctx.tx.execute(sql`
    insert into public.job_order_output
      (id, job_order_id, line_no, is_loss, quantity_kg, percent_of_input, location_id,
       produced_at, notes, created_by)
    values
      (${demoId(`job_output:${s.seed}:loss`)}, ${jobOrderId}, 5, true, ${lossKg.toFixed(3)},
       ${((lossKg / input) * 100).toFixed(3)}, ${lossSection}, ${completedAt},
       'Dust, chaff and moisture loss during sorting', ${r.productionOperatorId})
    on conflict (id) do nothing
  `)

  await postStockMovement(ctx, {
    seed: `${s.seed}:loss`,
    occurredAt: completedAt,
    movementType: 'PROCESS_LOSS',
    lotId,
    customerId: r.customerId,
    consignmentId,
    locationId: lossSection,
    quantityKg: lossKg.toFixed(3),
    keshaCount: 0,
    reasonCodeId: r.reasons['LOSS_DUST'],
    sourceType: 'job_order',
    sourceId: jobOrderId,
    actorId: r.productionOperatorId,
    correlationId,
    narrative: 'Routine sorting loss within tolerance',
  })

  await ctx.tx.execute(sql`
    update public.job_order
    set status = 'CLOSED',
        actual_output_kg = ${outputSum.toFixed(3)}, actual_loss_kg = ${lossKg.toFixed(3)},
        yield_pct = ${((outputSum / input) * 100).toFixed(3)},
        loss_pct = ${((lossKg / input) * 100).toFixed(3)},
        mass_balance_status = ${s.massBalanceException ? 'EXCEPTION' : 'BALANCED'},
        tolerance_applied_pct = '0.500',
        variance_kg = ${s.massBalanceException ? lossKg.toFixed(3) : '0.000'},
        variance_reason = ${s.massBalanceException ? 'Higher-than-usual dust loss — screen inspection scheduled' : null},
        completed_at = ${completedAt}, closed_at = ${completedAt}
    where id = ${jobOrderId}
  `)

  await ctx.tx.execute(sql`
    update public.lot set status = 'CONSUMED' where id = ${lotId}
  `)

  const approvedOutputLotId = demoId(`lot:${s.seed}:output:APPROVED`)

  if (tier < TIER.ACCEPTED_BY_CUSTOMER) return

  // ── M16: acceptance ─────────────────────────────────────────────────────
  const acceptanceId = demoId(`acceptance:${s.seed}`)
  const presentedAt = addis(scheduledOn, 15, 0)
  const signedAt = addis(scheduledOn, 16, 0)
  const approvedQty = Number(outputSum.toFixed(3))

  await ctx.tx.execute(sql`
    insert into public.acceptance_record
      (id, reference, branch_id, customer_id, consignment_id, job_order_id, status,
       presented_quantity_kg, accepted_quantity_kg, yield_pct, presented_at, presented_by,
       customer_rep_name, customer_rep_id_no, signed_at, witness_name, witness_user_id,
       closed_at, created_by)
    values
      (${acceptanceId}, ${ref('MIRT', 2026, s.n)}, ${r.branchId}, ${r.customerId}, ${consignmentId},
       ${jobOrderId}, 'ACCEPTED', ${approvedQty.toFixed(3)}, ${approvedQty.toFixed(3)},
       ${((outputSum / input) * 100).toFixed(3)}, ${presentedAt}, ${r.opsManagerId},
       'Customer Warehouse Representative', 'ID-4821093', ${signedAt}, 'Operations Manager',
       ${r.opsManagerId}, ${signedAt}, ${r.csoId})
    on conflict (id) do nothing
  `)

  for (const [i, split] of splits.entries()) {
    const outputLotId = demoId(`lot:${s.seed}:output:${split.code}`)
    const qty = Number((input * scaledPcts[i]!).toFixed(3))
    await ctx.tx.execute(sql`
      insert into public.acceptance_line
        (id, acceptance_id, line_no, lot_id, classification_id, presented_quantity_kg,
         accepted_quantity_kg, line_verdict, created_by)
      values
        (${demoId(`acceptance_line:${s.seed}:${split.code}`)}, ${acceptanceId}, ${i + 1},
         ${outputLotId}, ${r.outputs[split.code]}, ${qty.toFixed(3)}, ${qty.toFixed(3)},
         'ACCEPTED', ${r.csoId})
      on conflict (id) do nothing
    `)
  }

  await ctx.tx.execute(sql`
    update public.lot set status = 'ACCEPTED' where id = ${approvedOutputLotId}
  `)

  if (tier < TIER.RELEASE_REQUESTED) return

  // ── M17: release request, dispatch order ────────────────────────────────
  const releaseRequestId = demoId(`release_request:${s.seed}`)
  const primaryContactId = demoId(`contact:${s.customerSeed}:primary`)
  const releaseAt = addis(scheduledOn, 17, 0)
  await ctx.tx.execute(sql`
    insert into public.release_request
      (id, reference, branch_id, customer_id, consignment_id, status, requested_quantity_kg,
       requested_collection_on, authorised_by_contact_id, collector_name, collector_phone,
       vehicle_plate, submitted_at, approved_by, approved_at, created_by)
    values
      (${releaseRequestId}, ${ref('RR', 2026, s.n)}, ${r.branchId}, ${r.customerId},
       ${consignmentId}, 'APPROVED', ${approvedLotQty.toFixed(3)}, ${daysAgo(Math.max(s.arrivalDaysAgo - 6, 0))},
       ${primaryContactId}, 'Truck Driver', '+251911223399',
       ${`ET-3-A${10000 + r.bagCounter}`}, ${releaseAt}, ${r.opsManagerId},
       ${addis(scheduledOn, 17, 30)}, ${r.csoId})
    on conflict (id) do nothing
  `)

  if (tier < TIER.DISPATCHED) return

  const dispatchOrderId = demoId(`dispatch_order:${s.seed}`)
  const vehicleId = r.org.vehicleId[s.n % r.org.vehicleId.length]!
  const loadedAt = addis(scheduledOn, 18, 0)
  const gateOutAt = addis(scheduledOn, 18, 45)
  await ctx.tx.execute(sql`
    insert into public.dispatch_order
      (id, reference, branch_id, customer_id, consignment_id, release_request_id,
       acceptance_id, status, planned_quantity_kg, loaded_quantity_kg, loaded_kesha_count,
       vehicle_id, vehicle_plate, driver_name, destination, clearance_status,
       clearance_checked_at, clearance_checked_by, loading_started_at, loading_completed_at,
       gate_out_at, dispatched_at, created_by)
    values
      (${dispatchOrderId}, ${ref('DN', 2026, s.n)}, ${r.branchId}, ${r.customerId},
       ${consignmentId}, ${releaseRequestId}, ${acceptanceId}, 'DISPATCHED',
       ${approvedLotQty.toFixed(3)}, ${approvedLotQty.toFixed(3)}, ${Math.round(approvedLotQty / 60)},
       ${vehicleId}, ${`ET-3-A${10000 + r.bagCounter}`}, 'Contract Driver',
       'Djibouti Port (via Modjo Dry Port)', 'CLEARED', ${loadedAt}, ${r.gateOfficerId},
       ${addis(scheduledOn, 17, 45)}, ${loadedAt}, ${gateOutAt}, ${gateOutAt}, ${r.csoId})
    on conflict (id) do nothing
  `)

  await ctx.tx.execute(sql`
    insert into public.dispatch_line
      (id, dispatch_order_id, line_no, lot_id, location_id, bag_type_id, quantity_kg,
       kesha_count, loaded_at, created_by)
    values
      (${demoId(`dispatch_line:${s.seed}`)}, ${dispatchOrderId}, 1, ${approvedOutputLotId},
       ${section}, ${bagTypeId}, ${approvedLotQty.toFixed(3)}, ${Math.round(approvedLotQty / 60)},
       ${loadedAt}, ${r.opsManagerId})
    on conflict (id) do nothing
  `)

  await postStockMovement(ctx, {
    seed: `${s.seed}:dispatch`,
    occurredAt: gateOutAt,
    movementType: 'DISPATCH_OUT',
    lotId: approvedOutputLotId,
    customerId: r.customerId,
    consignmentId,
    locationId: section,
    quantityKg: `-${approvedLotQty.toFixed(3)}`,
    keshaCount: -Math.round(approvedLotQty / 60),
    bagTypeId,
    sourceType: 'dispatch_order',
    sourceId: dispatchOrderId,
    actorId: r.gateOfficerId,
    correlationId,
  })

  await ctx.tx.execute(sql`
    update public.lot set status = 'DISPATCHED' where id = ${approvedOutputLotId}
  `)

  await postKeshaMovement(ctx, {
    seed: `${s.seed}:kesha-returned`,
    occurredAt: gateOutAt,
    branchId: r.branchId,
    customerId: r.customerId,
    consignmentId,
    bagTypeId,
    locationId: section,
    movementType: 'RETURNED_EMPTY',
    keshaDelta: -Math.round(approvedLotQty / 60),
    sourceType: 'dispatch_order',
    sourceId: dispatchOrderId,
    actorId: r.gateOfficerId,
    balanceEffect: { heldFull: -Math.round(approvedLotQty / 60) },
  })

  await ctx.tx.execute(sql`
    insert into public.gate_event
      (id, branch_id, direction, vehicle_plate, driver_name, dispatch_order_id, capture_method,
       occurred_at, recorded_at, created_by)
    values
      (${demoId(`gate_event:${s.seed}`)}, ${r.branchId}, 'OUT',
       ${`ET-3-A${10000 + r.bagCounter}`}, 'Contract Driver', ${dispatchOrderId}, 'SCAN',
       ${gateOutAt}, ${gateOutAt}, ${r.gateOfficerId})
    on conflict (id) do nothing
  `)
}
