import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findCustomer,
  customerContacts,
  customerBankAccounts,
  type ContactRow,
  type CustomerBankRow,
} from '@modules/customers'
import { PageHeader, Card, CardHeader, Field, FieldGrid } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { Badge } from '@ui/primitives/Badge'

export const metadata: Metadata = { title: 'Profile' }

/**
 * The customer's own record, read-only.
 *
 * Changes go through EthioStar rather than a self-service form: the legal name, TIN and
 * licence are KYC facts that were verified at onboarding, and letting a customer edit them
 * afterwards would silently invalidate that verification.
 *
 * Bank account numbers arrive already masked from the query — the unmasked value never
 * leaves the database on this path, so no component here can accidentally render it.
 */
export default async function PortalProfilePage() {
  const { readiness, customerId, actor } = await pageContext()

  const [customer, contacts, banks] = await Promise.all([
    pageQuery(null, (tx) =>
      customerId ? findCustomer(tx, customerId).then((c) => c ?? null) : Promise.resolve(null),
    ),
    pageQuery([] as ContactRow[], (tx) =>
      customerId ? customerContacts(tx, customerId) : Promise.resolve([]),
    ),
    pageQuery([] as CustomerBankRow[], (tx) =>
      customerId ? customerBankAccounts(tx, customerId) : Promise.resolve([]),
    ),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your account with EthioStar. To change any of it, contact your branch — these details were verified at onboarding."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {/* ── The signed-in user ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Your sign-in"
          description="The user account you are signed in with."
        />
        <FieldGrid columns={3}>
          <Field label="Name">{actor?.fullName ?? '—'}</Field>
          <Field label="Email">{actor?.email ?? '—'}</Field>
          <Field label="Language">{actor?.locale === 'am' ? 'አማርኛ' : 'English'}</Field>
        </FieldGrid>
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          To change your password, use{' '}
          <span className="font-medium">Profile &amp; password</span> in the account menu.
          EthioStar never sends passwords by email.
        </p>
      </Card>

      {/* ── The organisation ──────────────────────────────────────────────── */}
      {customer ? (
        <>
          <Card>
            <CardHeader
              title={customer.legalName}
              description={customer.tradeName ? `Trading as ${customer.tradeName}` : undefined}
              action={<StatusChip status={customer.status} size="md" />}
            />
            <FieldGrid columns={3}>
              <Field label="Customer code">
                <span className="numeric">{customer.code}</span>
              </Field>
              <Field label="Business type">{customer.businessTypeName ?? '—'}</Field>
              <Field label="Branch">{customer.branchName ?? '—'}</Field>
              <Field label="TIN">
                <span className="numeric">{customer.tin ?? '—'}</span>
              </Field>
              <Field label="Business licence">
                <span className="numeric">{customer.businessLicenceNo ?? '—'}</span>
              </Field>
              <Field label="Licence expires">
                <OnDate value={customer.licenceExpiresOn} />
              </Field>
              <Field label="ECX membership">
                <span className="numeric">{customer.ecxMembershipNo ?? '—'}</span>
              </Field>
              <Field label="Region">{customer.regionName ?? '—'}</Field>
              <Field label="Woreda">{customer.woredaName ?? '—'}</Field>
              <Field label="Phone">
                <span className="numeric">{customer.primaryPhone ?? '—'}</span>
              </Field>
              <Field label="Email">{customer.primaryEmail ?? '—'}</Field>
              <Field label="Customer since">
                <OnDate value={customer.onboardedOn} />
              </Field>
            </FieldGrid>
          </Card>

          {/* ── Contacts ────────────────────────────────────────────────── */}
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Contacts"
                description="Only a contact marked as authorised may sign for a coffee release."
              />
            </div>

            {contacts.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
                No contacts recorded.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {contacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{contact.fullName}</span>
                        {contact.isPrimary ? (
                          <Badge tone="active" size="sm">
                            Primary
                          </Badge>
                        ) : null}
                        {contact.canAuthoriseRelease ? (
                          <Badge tone="complete" size="sm">
                            Can authorise release
                          </Badge>
                        ) : null}
                        {!contact.isActive ? (
                          <Badge tone="inactive" size="sm">
                            Inactive
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {contact.position ?? 'No position recorded'}
                      </p>
                    </div>
                    <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                      {contact.phone ?? ''}
                    </span>
                    <span className="shrink-0 truncate text-xs text-[var(--text-tertiary)]">
                      {contact.email ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Bank accounts ───────────────────────────────────────────── */}
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Bank accounts"
                description="Held for future settlement. Account numbers are shown masked."
              />
            </div>

            {banks.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
                No bank accounts recorded.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {banks.map((bank) => (
                  <li
                    key={bank.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <span className="shrink-0 font-medium">{bank.bankName}</span>
                    <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                      {bank.branchName ?? ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{bank.accountName}</span>
                    <span className="numeric shrink-0 text-sm">{bank.accountNumberMasked}</span>
                    {bank.isPrimary ? (
                      <Badge tone="active" size="sm">
                        Primary
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : readiness.ready ? (
        <Card>
          <CardHeader
            title="No customer record linked"
            description="Your sign-in is not yet bound to a customer account. Contact your EthioStar branch to have it linked."
          />
        </Card>
      ) : null}
    </div>
  )
}
