'use client'

import { useActionState, useState } from 'react'
import { Input, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { When } from '@ui/patterns/DateTime'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import {
  startReviewAction,
  attachDocumentAction,
  verifyDocumentAction,
  requestInfoAction,
  postMessageAction,
  rejectApplicationAction,
  approveApplicationAction,
} from './actions'
import type { ApplicationMessageRow } from '@modules/onboarding'

/**
 * The interactive half of the review screen.
 *
 * Every action is a real `<form action={dispatch}>` bound to a Server Action, so it works
 * before hydration and — because each action already calls `revalidatePath` server-side —
 * the page refreshes itself with no client-side fetch of its own. Small, single-purpose
 * components rather than one large form: a reviewer moves through the checklist document by
 * document, and each action (verify, attach, reject) should not risk discarding progress on
 * the others.
 */

function ErrorAlert({ state }: { readonly state: ActionResult<unknown> }) {
  if (state.ok) return null

  const issues = state.error.details?.issues as Array<{ detail: string }> | undefined

  return (
    <Alert tone="danger">
      <div>{state.error.message}</div>
      {issues && issues.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
          {issues.map((issue, index) => (
            <li key={index}>{issue.detail}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  )
}

export function StartReviewButton({ applicationId }: { readonly applicationId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await startReviewAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <ErrorAlert state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Starting…' : 'Start review'}
      </Button>
    </form>
  )
}

export function VerifyDocumentButtons({
  applicationId,
  documentId,
  hasExpiry,
}: {
  readonly applicationId: string
  readonly documentId: string
  readonly hasExpiry: boolean
}) {
  const [rejecting, setRejecting] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await verifyDocumentAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  if (rejecting) {
    return (
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="verdict" value="REJECTED" />
        <ErrorAlert state={state} />
        <Textarea
          label="Why is this document rejected?"
          name="rejectionReason"
          rows={2}
          error={errors.rejectionReason}
          required
        />
        <div className="flex gap-2">
          <Button type="submit" variant="danger" size="sm" disabled={pending}>
            Reject document
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="verdict" value="VERIFIED" />
      <ErrorAlert state={state} />

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Document no."
          name="documentNumber"
          className="w-40 text-sm"
          error={errors.documentNumber}
        />
        {hasExpiry ? (
          <Input
            label="Expires"
            name="expiresOn"
            type="date"
            className="w-40 text-sm"
            required
            error={errors.expiresOn}
          />
        ) : null}

        <div className="flex gap-2 pb-0.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
        </div>
      </div>
    </form>
  )
}

export function AttachDocumentForm({
  applicationId,
  documentTypeId,
}: {
  readonly applicationId: string
  readonly documentTypeId: string
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ fileId: string }>,
    FormData
  >(
    async (_prev, formData) =>
      (await attachDocumentAction(formData)) as ActionResult<{ fileId: string }>,
    ACTION_IDLE as unknown as ActionResult<{ fileId: string }>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="documentTypeId" value={documentTypeId} />
      <ErrorAlert state={state} />
      <Input
        label="File"
        name="file"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        required
        error={errors.file}
      />
      <Input label="Document no." name="documentNumber" className="sm:w-40" />
      <Input label="Expires" name="expiresOn" type="date" className="sm:w-40" />
      <Button type="submit" disabled={pending}>
        {pending ? 'Uploading…' : 'Attach'}
      </Button>
    </form>
  )
}

export function RequestInfoForm({ applicationId }: { readonly applicationId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await requestInfoAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  if (!open) {
    return (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        Request more information
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <ErrorAlert state={state} />
      <Textarea
        label="What do you need from the applicant?"
        name="note"
        rows={3}
        error={errors.note}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Send request
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function RejectForm({ applicationId }: { readonly applicationId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await rejectApplicationAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  if (!open) {
    return (
      <Button variant="danger" className="w-full" onClick={() => setOpen(true)}>
        Reject application
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <ErrorAlert state={state} />
      <Textarea
        label="Reason (shown to the applicant)"
        name="reason"
        rows={3}
        error={errors.reason}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          Confirm rejection
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

type ApproveResult = { customerId: string; customerCode: string; userId: string }

export function ApproveButton({ applicationId }: { readonly applicationId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<ApproveResult>, FormData>(
    async (_prev, formData) =>
      (await approveApplicationAction(formData)) as ActionResult<ApproveResult>,
    ACTION_IDLE as unknown as ActionResult<ApproveResult>,
  )

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <ErrorAlert state={state} />
      {state.ok && state.data ? (
        <Alert tone="success">Approved — customer {state.data.customerCode} created.</Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Approving…' : 'Approve and create customer'}
      </Button>
    </form>
  )
}

/** The applicant ⇄ reviewer reply thread. Oldest first, so it reads top-to-bottom like a chat. */
export function ChatThread({
  applicationId,
  messages,
}: {
  readonly applicationId: string
  readonly messages: readonly ApplicationMessageRow[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await postMessageAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">No messages yet.</p>
      ) : (
        <ol className="space-y-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-lg p-3 text-sm ${
                message.senderKind === 'STAFF'
                  ? 'bg-brand-50 dark:bg-brand-900/20'
                  : 'bg-[var(--surface-sunken)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
                <span className="font-medium text-[var(--text-secondary)]">
                  {message.senderKind === 'STAFF'
                    ? (message.senderName ?? 'EthioStar')
                    : 'Applicant'}
                </span>
                <When value={message.createdAt} />
              </div>
              <p className="mt-1 whitespace-pre-line">{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="applicationId" value={applicationId} />
        <ErrorAlert state={state} />
        <Textarea
          label="Reply to the applicant"
          name="body"
          rows={3}
          error={errors.body}
          required
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </form>
    </div>
  )
}
