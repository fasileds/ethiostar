'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { NotificationTemplateAdminRow } from '@modules/notification'
import {
  createNotificationTemplateAction,
  setNotificationTemplateActiveAction,
} from './actions'

// Phase 1 sends email only — see the notification spec's "email channel only".
const CHANNELS = [{ value: 'EMAIL', label: 'Email' }]

const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'am', label: 'Amharic' },
]

export function NotificationTemplatesClient({
  templates,
}: {
  readonly templates: readonly NotificationTemplateAdminRow[]
}) {
  return (
    <div className="space-y-6">
      <NewNotificationTemplateForm />
      <NotificationTemplateTable templates={templates} />
    </div>
  )
}

function NewNotificationTemplateForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await createNotificationTemplateAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a notification template</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Code"
          name="code"
          placeholder="delivery_request.approved"
          error={errors.code}
          required
        />
        <Select
          label="Channel"
          name="channel"
          options={CHANNELS}
          defaultValue="EMAIL"
          error={errors.channel}
          required
        />
        <Select
          label="Locale"
          name="locale"
          options={LOCALES}
          defaultValue="en"
          error={errors.locale}
          required
        />
        <Input label="Subject (optional)" name="subject" error={errors.subject} />
      </div>

      <Textarea label="Body" name="body" rows={5} error={errors.body} required />

      <Textarea
        label="Variables (advanced, optional)"
        name="variables"
        rows={3}
        hint="Raw JSON documenting the placeholders the body can reference. Leave blank unless you know the schema — there is no editor for it here yet."
        error={errors.variables}
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Publishing…' : 'Publish template'}
      </Button>
    </form>
  )
}

function NotificationTemplateTable({
  templates,
}: {
  readonly templates: readonly NotificationTemplateAdminRow[]
}) {
  if (templates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No notification templates yet. Publish the first one above.
      </p>
    )
  }

  const byCode = new Map<string, NotificationTemplateAdminRow[]>()
  for (const template of templates) {
    const group = byCode.get(template.code) ?? []
    group.push(template)
    byCode.set(template.code, group)
  }

  return (
    <div className="space-y-6">
      {[...byCode.entries()].map(([code, group]) => (
        <div key={code}>
          <h3 className="mb-2 font-mono text-sm font-semibold text-[var(--text-secondary)]">
            {code}
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
            {group.map((template) => (
              <NotificationTemplateRow key={template.id} template={template} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function NotificationTemplateRow({
  template,
}: {
  readonly template: NotificationTemplateAdminRow
}) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', template.id)
    formData.set('isActive', String(!template.isActive))
    await setNotificationTemplateActiveAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {template.channel}
          </span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            v{template.templateVersion}
          </span>
          <span className="text-2xs text-[var(--text-tertiary)]">{template.locale}</span>
          {!template.isActive ? (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Inactive
            </span>
          ) : null}
        </div>
        {template.subject ? (
          <p className="mt-1 text-sm font-medium">{template.subject}</p>
        ) : null}
        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-tertiary)]">
          {template.body}
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
        {template.isActive ? 'Deactivate' : 'Activate'}
      </Button>
    </li>
  )
}
