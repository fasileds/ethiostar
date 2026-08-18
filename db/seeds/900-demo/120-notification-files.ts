import { sql } from 'drizzle-orm'
import { demoId, addis, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M04 notifications and M05 files — the last two demo files. Notifications are queued for
 * both staff and portal recipients, in every delivery state a worker/retry queue produces;
 * files are metadata-only rows (no real bytes — Supabase Storage is out of scope for a
 * plain-SQL seed) representing what an upload pipeline would already have produced.
 */

interface NotificationSeed {
  seed: string
  channel: 'EMAIL' | 'SMS' | 'IN_APP'
  recipientCustomerSeed?: string
  recipientUserSeed?: string
  templateCode: string
  subject?: string
  body: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED'
  sourceType: string
  sourceId: string
  daysAgo: number
}

export async function seedNotificationsAndFiles(
  ctx: SeedContext,
  actorId: string,
  userIdBySeed: Map<string, string>,
): Promise<void> {
  const { log } = ctx

  const notifications: NotificationSeed[] = [
    {
      seed: 'notif:goods-receipt-posted',
      channel: 'EMAIL',
      recipientCustomerSeed: 'customer:abyssinia-highland',
      templateCode: 'goods_receipt.posted',
      subject: 'Goods receipt confirmed — GRN-2026-000001',
      body: 'Your delivery of 11,985 kg has been received and posted to your stock balance.',
      status: 'DELIVERED',
      sourceType: 'goods_receipt',
      sourceId: demoId('goods_receipt:cns-abyssinia-closed'),
      daysAgo: 150,
    },
    {
      seed: 'notif:acceptance-presented',
      channel: 'SMS',
      recipientCustomerSeed: 'customer:oromia-coffee-union',
      templateCode: 'acceptance.presented',
      body: 'Your processed output is ready for acceptance (MIRT-2026-000004). Please review in the portal.',
      status: 'SENT',
      sourceType: 'acceptance_record',
      sourceId: demoId('acceptance:cns-oromia-accepted-by-customer'),
      daysAgo: 50,
    },
    {
      seed: 'notif:dispatch-out',
      channel: 'IN_APP',
      recipientUserSeed: 'user:ops-manager',
      templateCode: 'dispatch.gate_out',
      subject: 'Dispatch DN-2026-000002 left the gate',
      body: 'Vehicle ET-3-A10002 departed at 18:45 with 150 kesha for Abyssinia Highland Exports.',
      status: 'DELIVERED',
      sourceType: 'dispatch_order',
      sourceId: demoId('dispatch_order:cns-abyssinia-dispatched'),
      daysAgo: 90,
    },
    {
      seed: 'notif:info-requested',
      channel: 'EMAIL',
      templateCode: 'application.info_requested',
      subject: 'Additional information required for your application',
      body: 'Please upload a current VAT certificate to continue processing your application.',
      status: 'FAILED',
      sourceType: 'customer_application',
      sourceId: demoId('application:nur-hussein'),
      daysAgo: 15,
    },
    {
      seed: 'notif:appointment-scheduled',
      channel: 'SMS',
      recipientCustomerSeed: 'customer:yirgacheffe-farmers',
      templateCode: 'appointment.confirmed',
      body: 'Your processing appointment is confirmed for the scheduled date. Please have your goods ready.',
      status: 'PENDING',
      sourceType: 'appointment',
      sourceId: demoId('appointment:cns-yirgacheffe-scheduled'),
      daysAgo: 0,
    },
    {
      seed: 'notif:cancelled-request',
      channel: 'EMAIL',
      recipientCustomerSeed: 'customer:guji-highlands',
      templateCode: 'delivery_request.rejected',
      subject: 'Your delivery request could not be approved',
      body: 'Your requested delivery window has no available storage capacity. Please resubmit.',
      status: 'CANCELLED',
      sourceType: 'delivery_request',
      sourceId: demoId('delivery_request:cns-guji-cancelled'),
      daysAgo: 98,
    },
  ]

  for (const n of notifications) {
    const recipientUserId = n.recipientUserSeed ? userIdBySeed.get(n.recipientUserSeed) : null
    const recipientCustomerId = n.recipientCustomerSeed ? demoId(n.recipientCustomerSeed) : null
    const sentAt = ['SENT', 'DELIVERED'].includes(n.status)
      ? addis(daysAgo(n.daysAgo), 9, 5)
      : null
    const deliveredAt = n.status === 'DELIVERED' ? addis(daysAgo(n.daysAgo), 9, 6) : null
    const failedAt = n.status === 'FAILED' ? addis(daysAgo(n.daysAgo), 9, 10) : null

    await ctx.tx.execute(sql`
      insert into public.notification
        (id, template_code, channel, recipient_user_id, recipient_customer_id, subject,
         rendered_body, status, sent_at, delivered_at, failed_at, failure_reason,
         attempt_count, source_type, source_id, correlation_id, created_by)
      values
        (${demoId(n.seed)}, ${n.templateCode}, ${n.channel}, ${recipientUserId ?? null},
         ${recipientCustomerId}, ${n.subject ?? null}, ${n.body}, ${n.status}, ${sentAt},
         ${deliveredAt}, ${failedAt},
         ${n.status === 'FAILED' ? 'SMTP gateway timeout after 3 attempts' : null},
         ${n.status === 'FAILED' ? 3 : n.status === 'PENDING' ? 0 : 1}, ${n.sourceType},
         ${n.sourceId}, ${demoId(`correlation:notif:${n.seed}`)}, ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`notifications: ${notifications.length} (PENDING/SENT/DELIVERED/FAILED/CANCELLED)`)

  // ── M05: stored file metadata (no real bytes — outside a plain-SQL seed's reach) ────
  const files: Array<{
    seed: string
    filename: string
    contentType: string
    category: string
    sourceType: string
    sourceId: string
    status: 'PENDING' | 'AVAILABLE' | 'QUARANTINED' | 'DELETED'
  }> = [
    {
      seed: 'file:trade-licence-abyssinia',
      filename: 'trade-licence-abyssinia-highland.pdf',
      contentType: 'application/pdf',
      category: 'KYC_DOCUMENT',
      sourceType: 'customer_application',
      sourceId: demoId('application:customer:abyssinia-highland'),
      status: 'AVAILABLE',
    },
    {
      seed: 'file:acceptance-signature-oromia',
      filename: 'acceptance-signature-mirt-2026-000004.png',
      contentType: 'image/png',
      category: 'SIGNATURE',
      sourceType: 'acceptance_record',
      sourceId: demoId('acceptance:cns-oromia-accepted-by-customer'),
      status: 'AVAILABLE',
    },
    {
      seed: 'file:upload-quarantined',
      filename: 'suspicious-upload.exe.pdf',
      contentType: 'application/pdf',
      category: 'OTHER',
      sourceType: 'customer_application',
      sourceId: demoId('application:habesha-gold'),
      status: 'QUARANTINED',
    },
    {
      seed: 'file:orphan-pending',
      filename: 'incomplete-upload.pdf',
      contentType: 'application/pdf',
      category: 'OTHER',
      sourceType: 'customer_application',
      sourceId: demoId('application:metu-union-draft'),
      status: 'PENDING',
    },
  ]

  for (const f of files) {
    await ctx.tx.execute(sql`
      insert into public.stored_file
        (id, bucket, object_key, original_filename, content_type, byte_size, source_type,
         source_id, category, status, uploaded_at, quarantine_reason, created_by)
      values
        (${demoId(f.seed)}, 'documents', ${`demo/${f.seed}`}, ${f.filename}, ${f.contentType},
         ${f.status === 'PENDING' ? null : 245760}, ${f.sourceType}, ${f.sourceId}, ${f.category},
         ${f.status}, ${f.status === 'PENDING' ? null : addis(daysAgo(30), 10, 0)},
         ${f.status === 'QUARANTINED' ? 'Executable content detected inside a PDF wrapper' : null},
         ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`stored files: ${files.length} (AVAILABLE/QUARANTINED/PENDING)`)

  // One access log entry, so "who looked at this file" has an answer.
  await ctx.tx.execute(sql`
    insert into public.file_access_log (id, file_id, actor_id, action, occurred_at)
    values
      (${demoId('file_access:trade-licence-view')}, ${demoId('file:trade-licence-abyssinia')},
       ${actorId}, 'VIEW', ${addis(daysAgo(5), 11, 0)})
    on conflict (id) do nothing
  `)
}
