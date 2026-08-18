import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listStaffUsers, type StaffUserRow } from '@modules/identity'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { CreateUserForm, UserRow } from './UsersClient'

export const metadata: Metadata = { title: 'Users' }

/**
 * M01/M23 — staff account provisioning. Every action here is attributable to a named user;
 * there are no shared or generic operational accounts (the M01 key control).
 */
export default async function UsersPage() {
  const { readiness } = await pageContext()
  const users = await pageQuery([] as StaffUserRow[], (tx) => listStaffUsers(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Staff accounts. A new account gets an activation link by email — never a plaintext password."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card>
        <CardHeader title="New staff account" />
        <div className="mt-4">
          <CreateUserForm />
        </div>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Staff accounts" />
        </div>
        <div className="overflow-x-auto px-4 pb-4 sm:px-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-tertiary)] uppercase">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium">Roles</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
          {users.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              No staff accounts yet.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
