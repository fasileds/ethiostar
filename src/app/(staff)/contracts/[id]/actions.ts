'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { addTariffLine, activateContract, terminateContract } from '@modules/contracts'
import { DEFAULT_CURRENCY } from '@config/constants'
import { businessDate } from '@core/utils/date'

const addTariffLineSchema = z.object({
  contractId: z.string().uuid(),
  branchId: z.string().uuid(),
  serviceCode: z.string().min(1, 'Choose a service.'),
  uom: z.enum(['PER_KG', 'PER_KESHA', 'PER_DAY', 'FLAT']),
  rateAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a rate.'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an effective date.'),
  negotiationReason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const addContractTariffLineAction = withAction({
  name: 'contracts.addTariffLine',
  permission: 'contract:manage_tariff',
  schema: addTariffLineSchema,
  handler: async (input, ctx) => {
    await addTariffLine(ctx.claims, {
      contractId: input.contractId,
      branchId: input.branchId,
      serviceCode: input.serviceCode,
      uom: input.uom,
      rateAmount: input.rateAmount,
      currency: DEFAULT_CURRENCY,
      effectiveFrom: businessDate(input.effectiveFrom),
      negotiationReason: input.negotiationReason ?? null,
      actorId: ctx.actor.userId,
    })

    revalidatePath(`/contracts/${input.contractId}`)
  },
})

const contractIdSchema = z.object({ contractId: z.string().uuid() })

export const activateContractAction = withAction({
  name: 'contracts.activateContract',
  permission: 'contract:activate',
  schema: contractIdSchema,
  handler: async (input, ctx) => {
    await activateContract(ctx.claims, {
      contractId: input.contractId,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/contracts/${input.contractId}`)
    revalidatePath('/contracts')
  },
})

const terminateSchema = z.object({
  contractId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Enter a reason.').max(500),
})

export const terminateContractAction = withAction({
  name: 'contracts.terminateContract',
  permission: 'contract:terminate',
  schema: terminateSchema,
  handler: async (input, ctx) => {
    await terminateContract(ctx.claims, {
      contractId: input.contractId,
      reason: input.reason,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/contracts/${input.contractId}`)
    revalidatePath('/contracts')
  },
})
