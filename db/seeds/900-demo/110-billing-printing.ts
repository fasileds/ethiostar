import { sql } from 'drizzle-orm'
import { demoId, addis, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M19/M20 billing and M06 printing — attached to the operational records 050-pipeline.ts
 * created, addressed the same way 100-labour.ts does: by recomputing `demoId` from the same
 * seed strings rather than threading return values through every file.
 */

interface ChargeSeed {
  seed: string
  customerSeed: string
  sourceType: string
  sourceId: string
  serviceCode: string
  uom: 'PER_KG' | 'PER_KESHA' | 'PER_DAY' | 'FLAT'
  quantity: number
  rate: number
  daysAgoOccurred: number
}

export async function seedBillingAndPrinting(
  ctx: SeedContext,
  branchId: string,
  actorId: string,
  financeOfficerId: string,
): Promise<void> {
  const { log } = ctx

  const charges: ChargeSeed[] = [
    {
      seed: 'charge:closed:unloading',
      customerSeed: 'customer:abyssinia-highland',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-abyssinia-closed'),
      serviceCode: 'UNLOADING',
      uom: 'PER_KESHA',
      quantity: 200,
      rate: 13.5,
      daysAgoOccurred: 150,
    },
    {
      seed: 'charge:closed:processing',
      customerSeed: 'customer:abyssinia-highland',
      sourceType: 'job_order',
      sourceId: demoId('job_order:cns-abyssinia-closed'),
      serviceCode: 'PROCESSING_PER_KG',
      uom: 'PER_KG',
      quantity: 11985,
      rate: 1.35,
      daysAgoOccurred: 145,
    },
    {
      seed: 'charge:dispatched:loading',
      customerSeed: 'customer:abyssinia-highland',
      sourceType: 'dispatch_order',
      sourceId: demoId('dispatch_order:cns-abyssinia-dispatched'),
      serviceCode: 'LOADING',
      uom: 'PER_KESHA',
      quantity: 150,
      rate: 13.5,
      daysAgoOccurred: 90,
    },
    {
      seed: 'charge:oromia:unloading',
      customerSeed: 'customer:oromia-coffee-union',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-oromia-accepted-by-customer'),
      serviceCode: 'UNLOADING',
      uom: 'PER_KESHA',
      quantity: 250,
      rate: 12.75,
      daysAgoOccurred: 50,
    },
    {
      seed: 'charge:kaffa:unloading-uninvoiced',
      customerSeed: 'customer:kaffa-forest-trading',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-kaffa-accepted'),
      serviceCode: 'UNLOADING',
      uom: 'PER_KESHA',
      quantity: 117,
      rate: 14.25,
      daysAgoOccurred: 4,
    },
  ]

  const chargeIdBySeed = new Map<string, string>()
  for (const c of charges) {
    const id = demoId(c.seed)
    chargeIdBySeed.set(c.seed, id)
    const amount = (c.quantity * c.rate).toFixed(2)
    await ctx.tx.execute(sql`
      insert into public.charge_event
        (id, customer_id, branch_id, service_code, source_type, source_id, quantity, uom,
         rate_amount, amount, occurred_at, created_by)
      select ${id}, cu.id, ${branchId}, ${c.serviceCode}, ${c.sourceType}, ${c.sourceId},
             ${c.quantity.toFixed(3)}, ${c.uom}, ${c.rate.toFixed(2)}, ${amount},
             ${addis(daysAgo(c.daysAgoOccurred), 16, 0)}, ${actorId}
      from public.customer cu where cu.id = ${demoId(c.customerSeed)}
      on conflict (id) do nothing
    `)
  }
  log(`charge events: ${charges.length} (one left uninvoiced — the aging/uninvoiced view)`)

  // Two invoices covering Abyssinia's first three charges, in different states; a fourth
  // customer's charge is left un-swept, deliberately, as the "uninvoiced" empty/edge state.
  const invoiceAId = demoId('invoice:abyssinia-1')
  const invoiceBId = demoId('invoice:abyssinia-2')
  const invoiceCId = demoId('invoice:oromia-1')
  const invoiceVoidId = demoId('invoice:void-example')

  const invoices: Array<{
    id: string
    reference: string
    customerSeed: string
    status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID'
    issueDaysAgo: number
    dueDaysAgo: number
    lines: Array<{ chargeSeed: string; description: string }>
    paidAmount?: string
  }> = [
    {
      id: invoiceAId,
      reference: 'INV-2026-000001',
      customerSeed: 'customer:abyssinia-highland',
      status: 'PAID',
      issueDaysAgo: 148,
      dueDaysAgo: 118,
      lines: [
        { chargeSeed: 'charge:closed:unloading', description: 'Unloading — GRN-2026-000001' },
      ],
      paidAmount: (200 * 13.5).toFixed(2),
    },
    {
      id: invoiceBId,
      reference: 'INV-2026-000002',
      customerSeed: 'customer:abyssinia-highland',
      status: 'PARTIALLY_PAID',
      issueDaysAgo: 88,
      dueDaysAgo: 58,
      lines: [
        { chargeSeed: 'charge:dispatched:loading', description: 'Loading — DN-2026-000002' },
      ],
      paidAmount: '1000.00',
    },
    {
      id: invoiceCId,
      reference: 'INV-2026-000003',
      customerSeed: 'customer:oromia-coffee-union',
      status: 'OVERDUE',
      issueDaysAgo: 48,
      dueDaysAgo: 18,
      lines: [
        { chargeSeed: 'charge:oromia:unloading', description: 'Unloading — GRN-2026-000004' },
      ],
    },
    {
      id: invoiceVoidId,
      reference: 'INV-2026-000004',
      customerSeed: 'customer:abyssinia-highland',
      status: 'VOID',
      issueDaysAgo: 100,
      dueDaysAgo: 70,
      lines: [
        { chargeSeed: 'charge:closed:processing', description: 'Processing — JOB-2026-000001' },
      ],
    },
  ]

  for (const inv of invoices) {
    const line = inv.lines[0]!
    const chargeId = chargeIdBySeed.get(line.chargeSeed)!
    const chargeRow = charges.find((c) => c.seed === line.chargeSeed)!
    const amount = (chargeRow.quantity * chargeRow.rate).toFixed(2)

    await ctx.tx.execute(sql`
      insert into public.invoice
        (id, reference, customer_id, branch_id, status, issue_date, due_date, subtotal_amount,
         tax_amount, total_amount, paid_amount, voided_at, voided_reason, created_by)
      values
        (${inv.id}, ${inv.reference}, ${demoId(inv.customerSeed)}, ${branchId}, ${inv.status},
         ${daysAgo(inv.issueDaysAgo)}, ${daysAgo(inv.dueDaysAgo)}, ${amount}, '0.00', ${amount},
         ${inv.paidAmount ?? '0.00'},
         ${inv.status === 'VOID' ? addis(daysAgo(inv.issueDaysAgo - 2), 10, 0) : null},
         ${inv.status === 'VOID' ? 'Raised against the wrong service code — reissued' : null},
         ${financeOfficerId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.invoice_line
        (id, invoice_id, charge_event_id, line_no, description, service_code, quantity, uom,
         rate_amount, line_amount, created_by)
      values
        (${demoId(`invoice_line:${inv.id}`)}, ${inv.id}, ${chargeId}, 1, ${line.description},
         ${chargeRow.serviceCode}, ${chargeRow.quantity.toFixed(3)}, ${chargeRow.uom},
         ${chargeRow.rate.toFixed(2)}, ${amount}, ${financeOfficerId})
      on conflict (id) do nothing
    `)

    if (inv.status !== 'VOID') {
      await ctx.tx.execute(sql`
        update public.charge_event set invoice_line_id = ${demoId(`invoice_line:${inv.id}`)}
        where id = ${chargeId} and invoice_line_id is null
      `)
    }
  }
  log(`invoices: ${invoices.length} (PAID/PARTIALLY_PAID/OVERDUE/VOID)`)

  // Payments against the PAID and PARTIALLY_PAID invoices.
  await ctx.tx.execute(sql`
    insert into public.payment
      (id, reference, customer_id, invoice_id, amount, method, external_reference, received_at,
       recorded_by, created_by)
    values
      (${demoId('payment:abyssinia-1')}, 'RCT-2026-000001', ${demoId('customer:abyssinia-highland')},
       ${invoiceAId}, ${(200 * 13.5).toFixed(2)}, 'BANK_TRANSFER', 'CBE-TXN-88213',
       ${addis(daysAgo(120), 11, 0)}, ${financeOfficerId}, ${financeOfficerId})
    on conflict (id) do nothing
  `)
  await ctx.tx.execute(sql`
    insert into public.payment
      (id, reference, customer_id, invoice_id, amount, method, external_reference, received_at,
       recorded_by, created_by)
    values
      (${demoId('payment:abyssinia-2')}, 'RCT-2026-000002', ${demoId('customer:abyssinia-highland')},
       ${invoiceBId}, '1000.00', 'CASH', null, ${addis(daysAgo(80), 15, 0)}, ${financeOfficerId},
       ${financeOfficerId})
    on conflict (id) do nothing
  `)
  log('payments: 2')

  // A manual credit hold on the suspended customer, unreleased — the "why can't this
  // customer schedule anything" answer M14/M17 check.
  await ctx.tx.execute(sql`
    insert into public.customer_credit_hold
      (id, customer_id, reason, note, is_automatic, held_by, held_at)
    values
      (${demoId('credit_hold:guji')}, ${demoId('customer:guji-highlands')}, 'OVERDUE_BALANCE',
       'Account suspended pending settlement of the 2026-Q1 statement.', false, ${financeOfficerId},
       ${addis(daysAgo(20), 9, 0)})
    on conflict (id) do nothing
  `)
  log('credit holds: 1 (unreleased)')

  // ── M06: printed documents ────────────────────────────────────────────────
  const printedDocs: Array<{
    seed: string
    documentType: string
    sourceType: string
    sourceId: string
    documentReference: string
    customerSeed: string
    copyNo: number
    daysAgoPrinted: number
    printedBy: string
  }> = [
    {
      seed: 'printed:grn-closed',
      documentType: 'GOODS_RECEIPT',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-abyssinia-closed'),
      documentReference: 'GRN-2026-000001',
      customerSeed: 'customer:abyssinia-highland',
      copyNo: 1,
      daysAgoPrinted: 150,
      printedBy: actorId,
    },
    {
      seed: 'printed:grn-closed-reprint',
      documentType: 'GOODS_RECEIPT',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-abyssinia-closed'),
      documentReference: 'GRN-2026-000001',
      customerSeed: 'customer:abyssinia-highland',
      copyNo: 2,
      daysAgoPrinted: 149,
      printedBy: actorId,
    },
    {
      seed: 'printed:mirt-oromia',
      documentType: 'ACCEPTANCE',
      sourceType: 'acceptance_record',
      sourceId: demoId('acceptance:cns-oromia-accepted-by-customer'),
      documentReference: 'MIRT-2026-000004',
      customerSeed: 'customer:oromia-coffee-union',
      copyNo: 1,
      daysAgoPrinted: 50,
      printedBy: actorId,
    },
    {
      seed: 'printed:dispatch-note',
      documentType: 'DELIVERY_NOTE',
      sourceType: 'dispatch_order',
      sourceId: demoId('dispatch_order:cns-abyssinia-dispatched'),
      documentReference: 'DN-2026-000002',
      customerSeed: 'customer:abyssinia-highland',
      copyNo: 1,
      daysAgoPrinted: 90,
      printedBy: actorId,
    },
  ]

  for (const p of printedDocs) {
    await ctx.tx.execute(sql`
      insert into public.printed_document
        (id, document_type, source_type, source_id, document_reference, customer_id, copy_no,
         reprint_reason, verification_token, printed_snapshot, object_key, printed_by,
         printed_at, printer_name, created_by)
      values
        (${demoId(p.seed)}, ${p.documentType}, ${p.sourceType}, ${p.sourceId},
         ${p.documentReference}, ${demoId(p.customerSeed)}, ${p.copyNo},
         ${p.copyNo > 1 ? 'Original mislaid at the weighbridge office' : null},
         ${demoId(`verify_token:${p.seed}`)}, ${JSON.stringify({ reference: p.documentReference })}::jsonb,
         ${`demo/${p.seed}.pdf`}, ${p.printedBy}, ${addis(daysAgo(p.daysAgoPrinted), 16, 30)},
         'Store Office Printer', ${p.printedBy})
      on conflict (id) do nothing
    `)
  }
  log(`printed documents: ${printedDocs.length} (incl. one reprint)`)

  // A verification scan against the first receipt, and one that resolves to nothing —
  // the "someone scanned a document we never issued" signal.
  await ctx.tx.execute(sql`
    insert into public.document_verification
      (id, printed_document_id, presented_token, result, scanned_at)
    values
      (${demoId('verification:grn-closed-valid')}, ${demoId('printed:grn-closed')},
       ${demoId('verify_token:printed:grn-closed')}, 'VALID', ${addis(daysAgo(148), 10, 0)})
    on conflict (id) do nothing
  `)
  await ctx.tx.execute(sql`
    insert into public.document_verification
      (id, presented_token, result, scanned_at)
    values
      (${demoId('verification:unknown-token')}, 'not-a-real-token-1234', 'NOT_FOUND',
       ${addis(daysAgo(10), 14, 0)})
    on conflict (id) do nothing
  `)
  log('document verifications: 2 (1 VALID, 1 NOT_FOUND)')
}
