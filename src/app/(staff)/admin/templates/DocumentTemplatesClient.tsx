'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { DocumentTemplateAdminRow } from '@modules/printing'
import { createDocumentTemplateAction, setDocumentTemplateActiveAction } from './actions'

const DOCUMENT_TYPES = [
  'GOODS_RECEIPT',
  'GATE_PASS',
  'ACCEPTANCE',
  'DELIVERY_NOTE',
  'COFFEE_PASSPORT',
  'LABEL',
]

const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'am', label: 'Amharic' },
]

const PAGE_SIZES = ['A4', 'A5', 'LABEL_100X150']

export function DocumentTemplatesClient({
  templates,
}: {
  readonly templates: readonly DocumentTemplateAdminRow[]
}) {
  return (
    <div className="space-y-6">
      <NewDocumentTemplateForm />
      <DocumentTemplateTable templates={templates} />
    </div>
  )
}

function NewDocumentTemplateForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await createDocumentTemplateAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a document template</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Code"
          name="code"
          placeholder="GOODS_RECEIPT_STANDARD"
          hint="Upper case, digits and underscores only."
          error={errors.code}
          required
        />
        <Select
          label="Document type"
          name="documentType"
          options={DOCUMENT_TYPES.map((value) => ({ value, label: value }))}
          placeholder="Choose a document type"
          error={errors.documentType}
          required
        />
        <Select
          label="Locale"
          name="locale"
          options={LOCALES}
          error={errors.locale}
          defaultValue="en"
          required
        />
        <Select
          label="Page size"
          name="pageSize"
          options={PAGE_SIZES.map((value) => ({ value, label: value }))}
          error={errors.pageSize}
          defaultValue="A4"
          required
        />
        <Input label="Title" name="title" error={errors.title} required />
      </div>

      <Textarea
        label="Layout (advanced, optional)"
        name="layout"
        rows={4}
        hint="Raw JSON consumed by the renderer. Leave blank unless you know the layout schema — there is no editor for it here yet."
        error={errors.layout}
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Publishing…' : 'Publish template'}
      </Button>
    </form>
  )
}

function DocumentTemplateTable({
  templates,
}: {
  readonly templates: readonly DocumentTemplateAdminRow[]
}) {
  if (templates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No document templates yet. Publish the first one above.
      </p>
    )
  }

  const byType = new Map<string, DocumentTemplateAdminRow[]>()
  for (const template of templates) {
    const group = byType.get(template.documentType) ?? []
    group.push(template)
    byType.set(template.documentType, group)
  }

  return (
    <div className="space-y-6">
      {[...byType.entries()].map(([documentType, group]) => (
        <div key={documentType}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">
            {documentType}
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
            {group.map((template) => (
              <DocumentTemplateRow key={template.id} template={template} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function DocumentTemplateRow({ template }: { readonly template: DocumentTemplateAdminRow }) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', template.id)
    formData.set('isActive', String(!template.isActive))
    await setDocumentTemplateActiveAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{template.code}</span>
          <span className="font-medium">{template.title}</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            v{template.templateVersion}
          </span>
          <span className="text-2xs text-[var(--text-tertiary)]">
            {template.locale} · {template.pageSize}
          </span>
          {!template.isActive ? (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Inactive
            </span>
          ) : null}
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
        {template.isActive ? 'Deactivate' : 'Activate'}
      </Button>
    </li>
  )
}
