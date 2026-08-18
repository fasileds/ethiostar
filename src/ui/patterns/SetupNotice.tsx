/**
 * The shape this needs, declared locally.
 *
 * `src/ui` may not import from `@server` — the design system must stay usable without the
 * server layer, and the boundaries rule enforces it. Duplicating a three-field union here
 * is cheaper than the coupling, and the caller adapts.
 */
export type SetupState =
  | { readonly ready: true }
  | {
      readonly ready: false
      readonly reason: 'NO_CONNECTION' | 'NO_SCHEMA'
      readonly detail: string
    }

/**
 * Shown in place of data when the database is not ready.
 *
 * It gives the exact commands rather than an apology. A developer hitting this on a fresh
 * clone should be able to copy three lines and be running — that is the whole job of this
 * component.
 *
 * It is deliberately calm rather than alarming: an unmigrated database on a new machine is
 * the expected state, not an incident.
 */
export function SetupNotice({ readiness }: { readonly readiness: SetupState }) {
  if (readiness.ready) return null

  const noConnection = readiness.reason === 'NO_CONNECTION'

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)]">
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] bg-warning-50 px-4 py-3 dark:bg-warning-900/20">
        <span className="mt-0.5 text-warning-700 dark:text-warning-100" aria-hidden>
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
            <path d="M10 2a1.1 1.1 0 0 1 .96.56l7.5 13A1.1 1.1 0 0 1 17.5 17h-15a1.1 1.1 0 0 1-.96-1.44l7.5-13A1.1 1.1 0 0 1 10 2Zm0 4.5a.9.9 0 0 0-.9.9v4a.9.9 0 0 0 1.8 0v-4a.9.9 0 0 0-.9-.9Zm0 8.6a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-warning-900 dark:text-warning-100">
            {noConnection ? 'The database is not running' : 'The database has no schema yet'}
          </h3>
          <p className="mt-0.5 text-sm text-warning-900/80 dark:text-warning-100/80">
            {noConnection
              ? 'Start Supabase, then apply the migrations.'
              : 'Supabase is running, but the CPMS migrations have not been applied.'}
          </p>
        </div>
      </div>

      <div className="px-4 py-4">
        <ol className="space-y-3">
          {(noConnection
            ? [
                {
                  cmd: 'supabase start',
                  note: 'Starts Postgres, Auth, Storage and Inbucket in Docker.',
                },
                { cmd: 'supabase db reset', note: 'Applies every migration from scratch.' },
                {
                  cmd: 'npm run db:seed',
                  note: 'Loads permissions, the twelve roles and master data.',
                },
              ]
            : [
                { cmd: 'supabase db reset', note: 'Applies every migration from scratch.' },
                {
                  cmd: 'npm run db:seed',
                  note: 'Loads permissions, the twelve roles and master data.',
                },
              ]
          ).map((step, index) => (
            <li key={step.cmd} className="flex gap-3">
              <span className="numeric mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-2xs font-semibold text-[var(--text-secondary)]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <code className="block rounded bg-[var(--surface-sunken)] px-2 py-1 font-mono text-sm">
                  {step.cmd}
                </code>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">{step.note}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-tertiary)]">
          The interface below renders without data, so the layout and design are reviewable
          before any rows exist. Nothing here is fabricated — empty means empty.
        </p>

        {readiness.reason === 'NO_CONNECTION' ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
              Connection error detail
            </summary>
            <pre className="mt-2 overflow-x-auto rounded bg-[var(--surface-sunken)] p-2 font-mono text-2xs text-[var(--text-secondary)]">
              {readiness.detail}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}
