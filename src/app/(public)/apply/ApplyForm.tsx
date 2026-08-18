'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Alert } from '@ui/primitives/Alert'
import { Button, ButtonLink } from '@ui/primitives/Button'
import { fieldErrorMap, ACTION_IDLE, type ActionResult } from '@server/actions/action-result'
import type { PublicKycRequirement } from '@modules/onboarding'
import { submitApplicationAction } from './actions'
import { documentFieldName } from './document-field'

/**
 * The public application form.
 *
 * ONE page, not a wizard. A multi-step flow with no save-and-resume — which is all an
 * anonymous applicant can have — loses everything the moment a connection drops, and this
 * form will be filled in on a phone with patchy signal.
 *
 * Progressive enhancement: it is a real `<form>` posting to a Server Action, so it works
 * before hydration. `useActionState` only improves the experience once JavaScript arrives.
 *
 * KYC documents are filed HERE, by the applicant, not later by the reviewer — the reviewer's
 * job is to check what was filed and ask for anything wrong or missing, not to be the one
 * typing it in. Which documents show depends on the business type chosen above them, so the
 * business-type `<select>` is watched (not made controlled) purely to redraw that section.
 */

export interface FormOption {
  readonly id: string
  readonly name: string
}

export interface ApplyFormProps {
  readonly branches: readonly FormOption[]
  readonly businessTypes: readonly FormOption[]
  readonly regions: readonly FormOption[]
  readonly coffeeTypes: readonly FormOption[]
  readonly kycRequirements: readonly PublicKycRequirement[]
  /** True when the database is not reachable — the form renders but cannot accept a submit. */
  readonly disabled?: boolean
}

type SubmitResult = ActionResult<{ reference: string } | undefined>

export function ApplyForm({
  branches,
  businessTypes,
  regions,
  coffeeTypes,
  kycRequirements,
  disabled = false,
}: ApplyFormProps) {
  const [state, formAction, pending] = useActionState<SubmitResult, FormData>(
    async (_previous, formData) => submitApplicationAction(formData) as Promise<SubmitResult>,
    ACTION_IDLE,
  )
  const [businessTypeId, setBusinessTypeId] = useState('')

  const errors = fieldErrorMap(state)
  const requiredDocuments = kycRequirements.filter((r) => r.businessTypeId === businessTypeId)

  // Success: the reference is the only thing the applicant needs, and losing it means losing
  // their ability to track the application at all. So it gets the whole screen.
  if (state.ok && state.data?.reference) {
    return (
      <div className="rounded-lg bg-[var(--surface-raised)] p-6 ring-1 ring-[var(--border-subtle)] sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-full bg-success-50 text-success-700 dark:bg-success-900/25 dark:text-success-100">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-6" aria-hidden>
            <path d="M8.1 13.4 4.7 10l-1.2 1.2 4.6 4.6 9-9L15.9 5.6z" />
          </svg>
        </div>

        <h2 className="mt-4 text-xl font-semibold">Application received</h2>
        <p className="mt-2 text-[var(--text-secondary)]">
          Write this reference down. You will need it to check progress, and we cannot look your
          application up without it.
        </p>

        <p className="numeric mt-5 rounded-md bg-[var(--surface-sunken)] px-4 py-3 text-lg font-semibold tracking-wide">
          {state.data.reference}
        </p>

        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          We have also emailed it to you. A member of the EthioStar team will review your
          documents and contact you.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={`/apply/status/${state.data.reference}`} variant="primary">
            Check status
          </ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Back to home
          </ButtonLink>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-8">
      {!state.ok ? (
        <Alert tone="danger" title="Your application was not submitted">
          {state.error.message}
          {state.error.requestId ? (
            <p className="numeric mt-1 text-xs opacity-75">
              Reference for support: {state.error.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      {disabled ? (
        <Alert tone="warning" title="Applications are temporarily unavailable">
          The service is not reachable right now. Please try again shortly, or contact your
          nearest EthioStar branch.
        </Alert>
      ) : null}

      {/* ── The business ────────────────────────────────────────────────── */}
      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">About your business</legend>

        <Input
          label="Registered business name"
          name="legalName"
          required
          autoComplete="organization"
          error={errors.legalName}
          hint="Exactly as it appears on your business licence."
        />

        <Input
          label="Trading name"
          name="tradeName"
          autoComplete="organization"
          error={errors.tradeName}
          hint="If you trade under a different name. Optional."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Business type"
            name="businessTypeId"
            placeholder="Select…"
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
            error={errors.tin}
            hint="Ten digits. Optional now, required before your first delivery."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Business licence number"
            name="businessLicenceNo"
            error={errors.businessLicenceNo}
          />
          <Select
            label="Region"
            name="regionId"
            placeholder="Select…"
            options={regions.map((option) => ({ value: option.id, label: option.name }))}
            error={errors.regionId}
          />
        </div>

        <Input
          label="City or town"
          name="city"
          autoComplete="address-level2"
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
            autoComplete="name"
            error={errors.contactName}
          />
          <Input
            label="Position"
            name="contactPosition"
            autoComplete="organization-title"
            error={errors.contactPosition}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Phone"
            name="contactPhone"
            type="tel"
            required
            autoComplete="tel"
            numeric
            error={errors.contactPhone}
            hint="We will call this number about your application."
          />
          <Input
            label="Email"
            name="contactEmail"
            type="email"
            required
            autoComplete="email"
            error={errors.contactEmail}
            hint="Your reference and account details are sent here."
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
            options={branches.map((option) => ({ value: option.id, label: option.name }))}
            error={errors.branchId}
          />
          <Select
            label="Main coffee type"
            name="primaryCoffeeTypeId"
            placeholder="Select…"
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
          error={errors.expectedAnnualVolumeKg}
          hint="A rough figure is fine — it helps us plan store space."
        />

        <Textarea
          id="intendedServices"
          label="What services are you interested in?"
          name="intendedServices"
          rows={4}
          maxLength={1000}
          placeholder="Storage, sorting, hulling, grading…"
          error={errors.intendedServices}
        />
      </fieldset>

      {/* ── Documents ────────────────────────────────────────────────────── */}
      {businessTypeId ? (
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Documents</legend>
          <p className="text-sm text-[var(--text-secondary)]">
            A reviewer checks these against your details — attach clear photos or scans.
            Optional documents can wait, but a missing mandatory one will hold up your
            application.
          </p>

          {requiredDocuments.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              Nothing required for this business type yet.
            </p>
          ) : (
            requiredDocuments.map((doc) => (
              <Input
                key={doc.documentTypeId}
                label={doc.name}
                name={documentFieldName(doc.documentTypeId)}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                required={doc.isMandatory}
                error={errors[documentFieldName(doc.documentTypeId)]}
                hint={doc.isMandatory ? undefined : 'Optional.'}
              />
            ))
          )}
        </fieldset>
      ) : null}

      <div className="border-t border-[var(--border-subtle)] pt-6">
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          We use these details and documents only to assess your application.
        </p>

        <Button type="submit" disabled={pending || disabled} size="lg">
          {pending ? 'Submitting…' : 'Submit application'}
        </Button>
      </div>
    </form>
  )
}
