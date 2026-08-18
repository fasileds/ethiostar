'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { systemClock } from '@core/clock/clock'
import { generateInvoice, issueInvoice, voidInvoice, recordPayment } from '@modules/billing'

const generateSchema = z.object({
  customerId: z.string().uuid('Choose a customer.'),
  branchId: z.string().uuid('Choose a branch.'),
  periodStart: z.string().min(1, 'Choose a start date.'),
  periodEnd: z.string().min(1, 'Choose an end date.'),
})

export const generateInvoiceAction = withAction({
  name: 'billing.generateInvoice',
  permission: 'billing:generate_invoice',
  schema: generateSchema,
  handler: async (input, ctx) => {
    const result = await generateInvoice(ctx.claims, {
      customerId: input.customerId,
      branchId: input.branchId,
      periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${input.periodEnd}T23:59:59.999Z`),
      actorId: ctx.actor.userId,
    })
    revalidatePath('/billing/invoices')
    return result
  },
})

const idSchema = z.object({ invoiceId: z.string().uuid() })

export const issueInvoiceAction = withAction({
  name: 'billing.issueInvoice',
  permission: 'billing:generate_invoice',
  schema: idSchema,
  handler: async (input, ctx) => {
    await issueInvoice(ctx.claims, input.invoiceId, ctx.actor.userId)
    revalidatePath(`/billing/invoices/${input.invoiceId}`)
    revalidatePath('/billing/invoices')
  },
})

const voidSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Say why this invoice is being voided.').max(500),
})

export const voidInvoiceAction = withAction({
  name: 'billing.voidInvoice',
  permission: 'billing:generate_invoice',
  schema: voidSchema,
  handler: async (input, ctx) => {
    await voidInvoice(ctx.claims, input.invoiceId, input.reason, ctx.actor.userId)
    revalidatePath(`/billing/invoices/${input.invoiceId}`)
    revalidatePath('/billing/invoices')
  },
})

const paymentSchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount.'),
  currency: z.string().trim().length(3).default('ETB'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY']),
  externalReference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const recordPaymentAction = withAction({
  name: 'billing.recordPayment',
  permission: 'billing:record_payment',
  schema: paymentSchema,
  handler: async (input, ctx) => {
    const result = await recordPayment(ctx.claims, {
      customerId: input.customerId,
      invoiceId: input.invoiceId ?? null,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      externalReference: input.externalReference ?? null,
      receivedAt: systemClock.now(),
      actorId: ctx.actor.userId,
    })
    if (input.invoiceId) revalidatePath(`/billing/invoices/${input.invoiceId}`)
    revalidatePath('/billing/invoices')
    revalidatePath('/billing')
    return result
  },
})
