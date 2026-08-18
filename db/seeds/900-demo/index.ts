import { sql } from 'drizzle-orm'
import type { SeedContext } from '../types'
import { seedIdentity, seedPortalUsers } from './010-identity'
import { seedCustomersAndOnboarding } from './020-customers'
import { seedContracts } from './030-contracts'
import { seedOrgMaster } from './040-org-master'
import { seedPipeline } from './050-pipeline'
import { seedLabour } from './100-labour'
import { seedBillingAndPrinting } from './110-billing-printing'
import { seedNotificationsAndFiles } from './120-notification-files'

/**
 * Demo dataset orchestrator — dev/staging only, run with `npm run seed:demo`.
 *
 * `ctx.includeDemo` is also checked by db/seeds/index.ts before this step is even pushed
 * onto the run list; the check is repeated here so this module stays safe to import and
 * call directly (a future script, a test fixture) without relying on the caller to have
 * gated it.
 */
export async function seedDemo(ctx: SeedContext): Promise<void> {
  if (!ctx.includeDemo) return

  const branchRow = (await ctx.tx.execute(
    sql`select id from public.branch where code = 'HQ'`,
  )) as unknown as Array<{ id: string }>
  const branchId = branchRow[0]?.id
  if (!branchId) {
    throw new Error('Demo seed requires the HQ branch — did 030-master-data run first?')
  }

  const { userIdBySeed } = await seedIdentity(ctx, branchId)
  const org = await seedOrgMaster(ctx, branchId, userIdBySeed.get('user:admin')!)
  const { customerIdBySeed } = await seedCustomersAndOnboarding(
    ctx,
    branchId,
    userIdBySeed.get('user:cso')!,
  )
  await seedPortalUsers(ctx, customerIdBySeed)
  await seedContracts(
    ctx,
    branchId,
    userIdBySeed.get('user:finance-officer')!,
    customerIdBySeed,
  )
  await seedPipeline(ctx, branchId, org, customerIdBySeed, userIdBySeed)
  await seedLabour(ctx, branchId, userIdBySeed.get('user:labour-coordinator')!)
  await seedBillingAndPrinting(
    ctx,
    branchId,
    userIdBySeed.get('user:admin')!,
    userIdBySeed.get('user:finance-officer')!,
  )
  await seedNotificationsAndFiles(ctx, userIdBySeed.get('user:admin')!, userIdBySeed)

  ctx.log('demo dataset complete')
}
