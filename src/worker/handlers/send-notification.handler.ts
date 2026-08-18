import { withServiceDb, type Tx } from '@db/client'
import { SYSTEM_ACTOR_ID } from '@modules/identity'
import {
  claimPendingNotifications,
  markNotificationSent,
  markNotificationFailed,
  type PendingNotification,
} from '@modules/notification'
import { mailer } from '@platform/mailer'
import type { JobContext } from './types'

/**
 * Deliver queued notifications.
 *
 * The three phases are separate transactions on purpose:
 *
 *   1. CLAIM   moves a batch PENDING → SENDING and COMMITS. The commit is what makes the
 *              claim visible to other workers, so the same credential letter is not sent
 *              twice. It also releases the row lock before any network I/O.
 *   2. SEND    happens outside every transaction. An SMTP host that hangs for twenty seconds
 *              must not hold a database transaction open for twenty seconds.
 *   3. RECORD  writes the outcome in its own short transaction.
 *
 * A crash between 2 and 3 leaves the row SENDING, which is recoverable and visible, rather
 * than losing the fact that a message went out.
 */

const BATCH_SIZE = 25
const MAX_ATTEMPTS = 5

async function deliver(item: PendingNotification, ctx: JobContext): Promise<void> {
  if (item.channel !== 'EMAIL') {
    // SMS and in-app are out of Phase 1 scope (§2.3 excludes SMS gateway integration).
    // Failing rather than silently dropping keeps the row visible on the delivery log.
    await withServiceDb(SYSTEM_ACTOR_ID, 'notification:unsupported-channel', (tx: Tx) =>
      markNotificationFailed(
        tx,
        item.id,
        `Channel ${item.channel} is not delivered in Phase 1.`,
        MAX_ATTEMPTS - 1,
        MAX_ATTEMPTS,
      ),
    )
    return
  }

  if (!item.recipientAddress) {
    await withServiceDb(SYSTEM_ACTOR_ID, 'notification:no-address', (tx: Tx) =>
      markNotificationFailed(
        tx,
        item.id,
        'No recipient address on the notification.',
        MAX_ATTEMPTS - 1,
        MAX_ATTEMPTS,
      ),
    )
    return
  }

  try {
    const sent = await mailer().send({
      to: item.recipientAddress,
      subject: item.subject ?? 'EthioStar',
      body: item.renderedBody,
    })

    await withServiceDb(SYSTEM_ACTOR_ID, 'notification:sent', (tx: Tx) =>
      markNotificationSent(tx, item.id, sent.providerMessageId),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    const outcome = await withServiceDb(SYSTEM_ACTOR_ID, 'notification:failed', (tx: Tx) =>
      markNotificationFailed(tx, item.id, message, item.attemptCount, MAX_ATTEMPTS),
    )

    if (outcome === 'FAILED') {
      // A customer who was never told something. Not a warning.
      ctx.log.error(
        { notificationId: item.id, err: message },
        'notification permanently failed — customer was not informed',
      )
    } else {
      ctx.log.warn(
        { notificationId: item.id, err: message },
        'notification send failed — retrying',
      )
    }
  }
}

export async function sendNotifications(ctx: JobContext): Promise<void> {
  const claimed = await withServiceDb(SYSTEM_ACTOR_ID, 'notification:claim', (tx: Tx) =>
    claimPendingNotifications(tx, BATCH_SIZE),
  )

  if (claimed.length === 0) return

  ctx.log.debug({ count: claimed.length }, 'sending notification batch')

  for (const item of claimed) {
    await deliver(item, ctx)
  }
}
