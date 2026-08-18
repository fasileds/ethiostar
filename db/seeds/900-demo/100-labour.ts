import { sql } from 'drizzle-orm'
import { demoId, addis, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M18 — workers, crews, attendance, piece-rate output and one payroll period.
 *
 * Ids of the job orders it attaches output to are recomputed from the SAME seed strings
 * 050-pipeline.ts used (`job_order:${scenarioSeed}`) rather than threaded through a return
 * value — every id in this dataset is a deterministic hash of a stable string (see
 * util.ts#demoId), so any file that knows the naming convention can address a row another
 * file created without an explicit dependency graph.
 */

interface WorkerSeed {
  seed: string
  code: string
  fullName: string
  gender: 'M' | 'F'
  activityCode: string
}

const WORKERS: readonly WorkerSeed[] = [
  {
    seed: 'worker:1',
    code: 'LW-0001',
    fullName: 'Almaz Tesfaye',
    gender: 'F',
    activityCode: 'UNLOAD_TRUCK',
  },
  {
    seed: 'worker:2',
    code: 'LW-0002',
    fullName: 'Belay Girma',
    gender: 'M',
    activityCode: 'UNLOAD_TRUCK',
  },
  {
    seed: 'worker:3',
    code: 'LW-0003',
    fullName: 'Chaltu Wakjira',
    gender: 'F',
    activityCode: 'STACKING',
  },
  {
    seed: 'worker:4',
    code: 'LW-0004',
    fullName: 'Dawit Mekonnen',
    gender: 'M',
    activityCode: 'LOAD_TO_LINE',
  },
  {
    seed: 'worker:5',
    code: 'LW-0005',
    fullName: 'Emebet Assefa',
    gender: 'F',
    activityCode: 'RE_BAGGING',
  },
  {
    seed: 'worker:6',
    code: 'LW-0006',
    fullName: 'Fikadu Tolossa',
    gender: 'M',
    activityCode: 'RE_BAGGING',
  },
  {
    seed: 'worker:7',
    code: 'LW-0007',
    fullName: 'Genet Abera',
    gender: 'F',
    activityCode: 'LOAD_TRUCK',
  },
  {
    seed: 'worker:8',
    code: 'LW-0008',
    fullName: 'Haile Demissie',
    gender: 'M',
    activityCode: 'LOAD_TRUCK',
  },
]

export async function seedLabour(
  ctx: SeedContext,
  branchId: string,
  actorId: string,
): Promise<void> {
  const { log } = ctx

  const crewAId = demoId('crew:a')
  const crewBId = demoId('crew:b')
  await ctx.tx.execute(sql`
    insert into public.labour_crew (id, branch_id, code, name, supervisor_id, created_by)
    values (${crewAId}, ${branchId}, 'CREW-A', 'Receiving & Stacking Crew', ${actorId}, ${actorId})
    on conflict (code) do nothing
  `)
  await ctx.tx.execute(sql`
    insert into public.labour_crew (id, branch_id, code, name, supervisor_id, created_by)
    values (${crewBId}, ${branchId}, 'CREW-B', 'Processing & Loading Crew', ${actorId}, ${actorId})
    on conflict (code) do nothing
  `)

  const activityIds = (await ctx.tx.execute(
    sql`select code, id from public.labour_activity_type`,
  )) as unknown as Array<{ code: string; id: string }>
  const activityByCode = new Map(activityIds.map((a) => [a.code, a.id]))

  const workerIds: string[] = []
  for (const [i, w] of WORKERS.entries()) {
    const id = demoId(w.seed)
    workerIds.push(id)
    const crewId = i < 3 ? crewAId : crewBId
    await ctx.tx.execute(sql`
      insert into public.labour_worker
        (id, branch_id, worker_code, full_name, gender, engagement_type,
         default_activity_type_id, engaged_on, created_by)
      values
        (${id}, ${branchId}, ${w.code}, ${w.fullName}, ${w.gender}, 'DAILY',
         ${activityByCode.get(w.activityCode) ?? null}, ${daysAgo(300)}, ${actorId})
      on conflict (worker_code) do nothing
    `)
    await ctx.tx.execute(sql`
      insert into public.labour_crew_member (id, crew_id, worker_id, joined_on, created_by)
      values (${demoId(`crew_member:${w.seed}`)}, ${crewId}, ${id}, ${daysAgo(300)}, ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`labour workers: ${WORKERS.length} across 2 crews`)

  // Two weeks of attendance for every worker, with a mix of PRESENT / LATE / ABSENT.
  const statuses: ReadonlyArray<'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY'> = [
    'PRESENT',
    'PRESENT',
    'PRESENT',
    'LATE',
    'PRESENT',
    'ABSENT',
    'HALF_DAY',
  ]
  let attendanceCount = 0
  for (const [wi, workerId] of workerIds.entries()) {
    for (let d = 1; d <= 14; d++) {
      const status = statuses[(wi + d) % statuses.length]!
      const day = daysAgo(d)
      await ctx.tx.execute(sql`
        insert into public.labour_attendance
          (id, worker_id, attendance_on, check_in_at, check_out_at, status, absence_reason,
           recorded_by, created_by)
        values
          (${demoId(`attendance:${workerId}:${d}`)}, ${workerId}, ${day},
           ${status === 'ABSENT' ? null : addis(day, status === 'LATE' ? 8 : 6, 30)},
           ${status === 'ABSENT' ? null : addis(day, 15, 0)}, ${status},
           ${status === 'ABSENT' ? 'Reported sick' : null}, ${actorId}, ${actorId})
        on conflict (worker_id, attendance_on, shift_id) do nothing
      `)
      attendanceCount += 1
    }
  }
  log(`attendance records: ${attendanceCount} (14 days x ${workerIds.length} workers)`)

  // Piece-rate output against the job orders the pipeline created, one per status branch.
  const outputScenarios: Array<{
    seed: string
    jobOrderSeed: string
    workerIdx: number
    activityCode: string
    kesha: number
    status: 'RECORDED' | 'APPROVED' | 'PAID' | 'REJECTED'
  }> = [
    {
      seed: 'output:closed:unload',
      jobOrderSeed: 'job_order:cns-abyssinia-closed',
      workerIdx: 0,
      activityCode: 'UNLOAD_TRUCK',
      kesha: 200,
      status: 'PAID',
    },
    {
      seed: 'output:dispatched:rebag',
      jobOrderSeed: 'job_order:cns-abyssinia-dispatched',
      workerIdx: 4,
      activityCode: 'RE_BAGGING',
      kesha: 150,
      status: 'APPROVED',
    },
    {
      seed: 'output:accepted-by-customer:load',
      jobOrderSeed: 'job_order:cns-oromia-accepted-by-customer',
      workerIdx: 6,
      activityCode: 'LOAD_TO_LINE',
      kesha: 250,
      status: 'RECORDED',
    },
    {
      seed: 'output:processed:rebag',
      jobOrderSeed: 'job_order:cns-tesfaye-processed',
      workerIdx: 5,
      activityCode: 'RE_BAGGING',
      kesha: 50,
      status: 'REJECTED',
    },
  ]

  for (const o of outputScenarios) {
    const workerId = workerIds[o.workerIdx]!
    const activityId = activityByCode.get(o.activityCode) ?? null
    const rateRow = (await ctx.tx.execute(
      sql`select rate_amount from public.labour_rate where activity_type_id = ${activityId} limit 1`,
    )) as unknown as Array<{ rate_amount: string }>
    const rate = rateRow[0]?.rate_amount ?? '2.00'
    const amount = (Number(rate) * o.kesha).toFixed(2)
    const producedOn = daysAgo(30)

    await ctx.tx.execute(sql`
      insert into public.labour_output
        (id, worker_id, job_order_id, activity_type_id, produced_on, kesha_count, rate_basis,
         rate_amount, calculated_amount, status, recorded_by, approved_by, approved_at,
         rejection_reason, created_by)
      values
        (${demoId(o.seed)}, ${workerId}, ${demoId(o.jobOrderSeed)}, ${activityId}, ${producedOn},
         ${o.kesha}, 'PER_KESHA', ${rate}, ${amount}, ${o.status}, ${actorId},
         ${o.status === 'APPROVED' || o.status === 'PAID' ? actorId : null},
         ${o.status === 'APPROVED' || o.status === 'PAID' ? addis(producedOn, 17, 0) : null},
         ${o.status === 'REJECTED' ? 'Count disputed by supervisor — recount pending' : null},
         ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`labour output records: ${outputScenarios.length} (RECORDED/APPROVED/PAID/REJECTED)`)

  // One CLOSED payroll period covering the PAID output above.
  await ctx.tx.execute(sql`
    insert into public.labour_payroll_period
      (id, branch_id, reference, period_start_on, period_end_on, status, worker_count,
       total_amount, calculated_at, approved_by, approved_at, closed_at, created_by)
    values
      (${demoId('payroll:period-1')}, ${branchId}, 'PAY-2026-07', ${daysAgo(45)}, ${daysAgo(31)},
       'CLOSED', ${workerIds.length}, '18500.00', ${addis(daysAgo(30), 9, 0)}, ${actorId},
       ${addis(daysAgo(29), 9, 0)}, ${addis(daysAgo(28), 9, 0)}, ${actorId})
    on conflict (id) do nothing
  `)
  log('payroll periods: 1 (CLOSED)')
}
