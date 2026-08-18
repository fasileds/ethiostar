import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listNotificationTemplates,
  type NotificationTemplateAdminRow,
} from '@modules/notification'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { NotificationTemplatesClient } from './NotificationTemplatesClient'

export const metadata: Metadata = { title: 'Notification templates' }

/**
 * M04 — the message bodies a customer or staff member actually receives. Templates are
 * versioned and resolved at send time (`resolveTemplate`), which is what lets a message sent
 * months ago be reconstructed exactly even after the template has moved on.
 */
export default async function NotificationTemplatesPage() {
  const { readiness } = await pageContext()

  const templates = await pageQuery([] as NotificationTemplateAdminRow[], (tx) =>
    listNotificationTemplates(tx),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification templates"
        description="Message bodies in English and Amharic, versioned so a sent message can be replayed exactly."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Templates by code"
            description="Publishing a new version never overwrites one already in use — it adds a new template_version row."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <NotificationTemplatesClient templates={templates} />
        </div>
      </Card>
    </div>
  )
}
