'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Alert } from '@ui/primitives/Alert'
import { Button } from '@ui/primitives/Button'
import { fieldErrorMap, ACTION_IDLE, type ActionResult } from '@server/actions/action-result'
import type {
  PublicApplicationMessageRow,
  PublicApplicationDocumentRow,
  PublicApplicationDetails,
  PublicKycRequirement,
} from '@modules/onboarding'
import { submitReplyAction } from './actions'
import { documentFieldName } from '../../document-field'

export interface FormOption {
  readonly id: string
  readonly name: string
}

/**
 * The applicant's half of the reply thread: the conversation so far, then a form that can
 * carry a message, corrected details and re-uploaded documents in one submission.
 *
 * It supports both a simple reply/corrections form (when info is requested) and a full-edit form
 * that allows resubmitting the entire application.
 */
export interface ReplyPanelProps {
  readonly reference: string
  readonly messages: readonly PublicApplicationMessageRow[]
  readonly documents: readonly PublicApplicationDocumentRow[]
  readonly details: PublicApplicationDetails
  readonly branches: readonly FormOption[]
  readonly businessTypes: readonly FormOption[]
  readonly regions: readonly FormOption[]
  readonly coffeeTypes: readonly FormOption[]
  readonly kycRequirements: readonly PublicKycRequirement[]
  readonly awaitingReply?: boolean
}

export function ReplyPanel({
  reference,
  messages,
  documents,
  details,
  branches,
  businessTypes,
  regions,
  coffeeTypes,
  kycRequirements,
  awaitingReply = false,
}: ReplyPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [businessTypeId, setBusinessTypeId] = useState(details.businessTypeId ?? '')
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => {
      const res = (await submitReplyAction(formData)) as ActionResult<void>
      if (res.ok) {
        setIsEditing(false)
        setShowDetails(false)
      }
      return res
    },
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

const outstandingDocuments = (documents ?? []).filter(
  (d) => d.verificationStatus === 'REJECTED' || !d.originalFilename,
)

const requiredDocuments = (kycRequirements ?? []).filter(
  (r) => r.businessTypeId === businessTypeId,
)

  // ── Render Full Edit Form ───────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
          <h2 className="text-xl font-semibold">Edit your application</h2>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-sm font-medium text-[var(--text-secondary)] hover:underline"
          >
            Cancel
          </button>
        </div>

        <form action={formAction} className="space-y-8">
          <input type="hidden" name="reference" value={reference} />
          {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

          <Textarea
            label="What did you update?"
            name="message"
            rows={2}
            required
            error={errors.message}
            placeholder="Explain what changes you have made in this update…"
          />

          {/* ── The business ────────────────────────────────────────────────── */}
          <fieldset className="space-y-4">
            <legend className="text-lg font-semibold">About your business</legend>

            <Input
              label="Registered business name"
              name="legalName"
              required
              defaultValue={details.legalName}
              error={errors.legalName}
              hint="Exactly as it appears on your business licence."
            />

            <Input
              label="Trading name"
              name="tradeName"
              defaultValue={details.tradeName ?? ''}
              error={errors.tradeName}
              hint="If you trade under a different name. Optional."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Business type"
                name="businessTypeId"
                placeholder="Select…"
                defaultValue={businessTypeId}
                options={businessTypes.map((option) => ({ value: option.id, label: option.name }))}
                error={errors.businessTypeId}
                onChange={(event) => setBusinessTypeId(event.target.value)}
              />
              <Input
                label="TIN"
                name="tin"
                numeric
                inputMode="numeric"
                maxLength={10}
                defaultValue={details.tin ?? ''}
                error={errors.tin}
                hint="Ten digits. Optional now, required before your first delivery."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Business licence number"
                name="businessLicenceNo"
                defaultValue={details.businessLicenceNo ?? ''}
                error={errors.businessLicenceNo}
              />
              <Select
                label="Region"
                name="regionId"
                placeholder="Select…"
                defaultValue={details.regionId ?? ''}
                options={regions.map((option) => ({ value: option.id, label: option.name }))}
                error={errors.regionId}
              />
            </div>

            <Input
              label="City or town"
              name="city"
              defaultValue={details.city ?? ''}
              error={errors.city}
            />
          </fieldset>

          {/* ── The contact ─────────────────────────────────────────────────── */}
          <fieldset className="space-y-4">
            <legend className="text-lg font-semibold">Who should we contact?</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                name="contactName"
                required
                defaultValue={details.contactName}
                error={errors.contactName}
              />
              <Input
                label="Position"
                name="contactPosition"
                defaultValue={details.contactPosition ?? ''}
                error={errors.contactPosition}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                name="contactPhone"
                type="tel"
                required
                numeric
                defaultValue={details.contactPhone}
                error={errors.contactPhone}
              />
              <Input
                label="Email"
                name="contactEmail"
                type="email"
                required
                defaultValue={details.contactEmail}
                error={errors.contactEmail}
              />
            </div>
          </fieldset>

          {/* ── What they need ──────────────────────────────────────────────── */}
          <fieldset className="space-y-4">
            <legend className="text-lg font-semibold">What do you need from EthioStar?</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Which branch would you deliver to?"
                name="branchId"
                required
                placeholder="Select a branch…"
                defaultValue={details.branchId}
                options={branches.map((option) => ({ value: option.id, label: option.name }))}
                error={errors.branchId}
              />
              <Select
                label="Main coffee type"
                name="primaryCoffeeTypeId"
                placeholder="Select…"
                defaultValue={details.primaryCoffeeTypeId ?? ''}
                options={coffeeTypes.map((option) => ({ value: option.id, label: option.name }))}
                error={errors.primaryCoffeeTypeId}
              />
            </div>

            <Input
              label="Expected volume per year"
              name="expectedAnnualVolumeKg"
              unit="kg"
              numeric
              inputMode="decimal"
              defaultValue={details.expectedAnnualVolumeKg ?? ''}
              error={errors.expectedAnnualVolumeKg}
            />

            <Textarea
              label="What services are you interested in?"
              name="intendedServices"
              rows={4}
              maxLength={1000}
              defaultValue={details.intendedServices ?? ''}
              error={errors.intendedServices}
            />
          </fieldset>

          {/* ── Documents ────────────────────────────────────────────────────── */}
          {businessTypeId ? (
            <fieldset className="space-y-4">
              <legend className="text-lg font-semibold">Documents</legend>
              <p className="text-sm text-[var(--text-secondary)]">
                Attach clear photos or scans. You only need to select a file if you want to replace
                the currently uploaded one.
              </p>

              {requiredDocuments.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">
                  Nothing required for this business type yet.
                </p>
              ) : (
                requiredDocuments.map((doc) => {
                  const existingDoc = documents.find((d) => d.documentTypeId === doc.documentTypeId)
                  const isRequired = doc.isMandatory && !existingDoc?.originalFilename

                  return (
                    <div key={doc.documentTypeId} className="space-y-1">
                      <Input
                        label={doc.name}
                        name={documentFieldName(doc.documentTypeId)}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        required={isRequired}
                        error={errors[documentFieldName(doc.documentTypeId)]}
                        hint={
                          existingDoc?.originalFilename
                            ? `Current file: ${existingDoc.originalFilename}`
                            : doc.isMandatory
                              ? 'Required.'
                              : 'Optional.'
                        }
                      />
                    </div>
                  )
                })
              )}
            </fieldset>
          ) : null}

          <div className="flex gap-4 border-t border-[var(--border-subtle)] pt-6">
            <Button type="submit" disabled={pending} variant="primary">
              {pending ? 'Resubmitting…' : 'Resubmit application'}
            </Button>
            <Button type="button" onClick={() => setIsEditing(false)} variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // ── Render Default Thread & Action View ─────────────────────────────────────
  return (
    <div className="space-y-4">
      {state.ok ? (
        <Alert tone="success" title="Sent">
          Your application has been updated and is back with a reviewer.
        </Alert>
      ) : null}
      {messages.length > 0 ? (
        <ol className="space-y-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-lg p-3 text-sm ${
                message.senderKind === 'STAFF'
                  ? 'bg-[var(--surface-raised)] ring-1 ring-[var(--border-subtle)]'
                  : 'bg-warning-50 dark:bg-warning-900/20'
              }`}
            >
              <div className="text-xs font-medium text-[var(--text-tertiary)]">
                {message.senderKind === 'STAFF' ? 'EthioStar' : 'You'}
              </div>
              <p className="mt-1 whitespace-pre-line text-[var(--text-primary)]">{message.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {awaitingReply ? (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="reference" value={reference} />
          {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

          <Textarea
            label="Your reply"
            name="message"
            rows={3}
            required
            error={errors.message}
            placeholder="Explain what you have corrected or attached…"
          />

          {outstandingDocuments.length > 0 ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Documents to re-send</legend>
              {outstandingDocuments.map((doc) => (
                <div key={doc.documentTypeId}>
                  <Input
                    label={doc.name}
                    name={documentFieldName(doc.documentTypeId)}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    error={errors[documentFieldName(doc.documentTypeId)]}
                    hint={
                      doc.verificationStatus === 'REJECTED' && doc.rejectionReason
                        ? doc.rejectionReason
                        : doc.isMandatory
                          ? undefined
                          : 'Optional.'
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : null}

          {showDetails ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Update your details</legend>
              <p className="text-xs text-[var(--text-tertiary)]">
                Leave anything blank to keep it unchanged.
              </p>
              <Input
                label="Registered business name"
                name="legalName"
                defaultValue={details.legalName}
                error={errors.legalName}
              />
              <Input
                label="Trading name"
                name="tradeName"
                defaultValue={details.tradeName ?? ''}
                error={errors.tradeName}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="TIN"
                  name="tin"
                  numeric
                  inputMode="numeric"
                  maxLength={10}
                  defaultValue={details.tin ?? ''}
                  error={errors.tin}
                />
                <Input
                  label="Business licence number"
                  name="businessLicenceNo"
                  defaultValue={details.businessLicenceNo ?? ''}
                  error={errors.businessLicenceNo}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Contact name"
                  name="contactName"
                  defaultValue={details.contactName}
                  error={errors.contactName}
                />
                <Input
                  label="Position"
                  name="contactPosition"
                  defaultValue={details.contactPosition ?? ''}
                  error={errors.contactPosition}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Phone"
                  name="contactPhone"
                  type="tel"
                  numeric
                  defaultValue={details.contactPhone}
                  error={errors.contactPhone}
                />
                <Input
                  label="Email"
                  name="contactEmail"
                  type="email"
                  required
                  defaultValue={details.contactEmail}
                  error={errors.contactEmail}
                />
              </div>
              <Textarea
                label="What services are you interested in?"
                name="intendedServices"
                rows={3}
                defaultValue={details.intendedServices ?? ''}
                error={errors.intendedServices}
              />
            </fieldset>
          ) : (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="text-sm text-[var(--text-brand)] underline hover:no-underline"
            >
              Also update your business or contact details
            </button>
          )}

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Sending…' : 'Send reply'}
            </Button>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-sm font-medium text-[var(--text-brand)] hover:underline"
            >
              Edit entire application instead
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 text-center sm:p-6">
          <h3 className="font-semibold text-[var(--text-primary)]">Need to update your details?</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            You can edit any details or re-upload documents before a decision is made.
          </p>
          <Button
            type="button"
            onClick={() => setIsEditing(true)}
            variant="secondary"
            className="mt-4"
          >
            Edit application
          </Button>
        </div>
      )}
    </div>
  )
}
