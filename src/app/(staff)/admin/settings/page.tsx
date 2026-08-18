import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listSettings, type SettingRow } from '@modules/administration'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { SettingRowEditor } from './SettingsForm'

export const metadata: Metadata = { title: 'Settings' }

/**
 * M23 — the settings console. Every change here is logged with the old and new value
 * (`system_setting_history`, append-only) — the module's own key control.
 */
export default async function SettingsPage() {
  const { readiness } = await pageContext()
  const settings = await pageQuery([] as SettingRow[], (tx) => listSettings(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Business rules, tolerances and thresholds. Every change is logged with who made it and what it was before."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="divide-y divide-[var(--border-subtle)] px-4 sm:px-5">
          {settings.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              No settings found. Run the seed to populate the catalogue.
            </p>
          ) : (
            settings.map((setting) => <SettingRowEditor key={setting.key} setting={setting} />)
          )}
        </div>
      </Card>
    </div>
  )
}
