import { sql } from 'drizzle-orm'
import { uuidv7 } from '../../src/core/ids/id-generator'
import { SYSTEM_ACTOR_ID } from '../../src/modules/identity/domain/actor'
import { NOTIFICATION_TEMPLATES as T } from '../../src/modules/notification/domain/template-codes'
import type { SeedContext } from './types'

/**
 * M04 notification templates.
 *
 * Idempotent on `(code, channel, locale, template_version)`. The BODY is set on INSERT and
 * then left alone: an administrator who edits wording in the console must not have it
 * reverted by the next deploy. Publishing new wording from code means bumping
 * `template_version`, which is the mechanism that keeps already-sent messages reproducible.
 *
 * ⚠️ ENGLISH ONLY at this version. `resolveTemplate` falls back to `en` when a locale has no
 * template, so an Amharic-preferring customer is still told what happened rather than
 * nothing. The Amharic pass is roadmap Step 24, together with Ethiopic rendering
 * verification in the PDFs — translating twenty operational templates without a native
 * reviewer would put unverified Amharic in front of customers, which is worse than the
 * documented fallback.
 *
 * ⚠️ The organisation name below is spelled "EthioStar". Decision #1 in
 * docs/phase-1/STATUS.md — the legal and brand spelling is still owed by the client, and it
 * appears in every one of these messages.
 */

interface Template {
  readonly code: string
  readonly subject: string
  readonly body: string
  readonly description: string
}

const SIGN_OFF = '\n\nEthioStar Coffee Sorting & Processing Services'

const TEMPLATES: readonly Template[] = [
  {
    code: T.APPLICATION_RECEIVED,
    subject: 'Your EthioStar application {{reference}}',
    description: 'Sent when a public application is submitted.',
    body:
      'Dear {{contactName}},\n\n' +
      'We have received the application from {{legalName}} to use EthioStar’s sorting service.\n\n' +
      'Your tracking reference is {{reference}}. Keep it — you can check progress at any time at {{statusUrl}} without needing an account.\n\n' +
      'We will contact you once the submitted documents have been verified.' +
      SIGN_OFF,
  },
  {
    code: T.APPLICATION_INFO_REQUESTED,
    subject: 'More information needed — application {{reference}}',
    description: 'Sent when a reviewer returns an application for correction.',
    body:
      'Dear {{contactName}},\n\n' +
      'We need more information before we can complete the review of application {{reference}} for {{legalName}}.\n\n' +
      'What we need:\n{{infoRequested}}\n\n' +
      'Please reply to this message or contact the branch, quoting your reference.' +
      SIGN_OFF,
  },
  {
    code: T.APPLICATION_REJECTED,
    subject: 'Application {{reference}} — outcome',
    description: 'Sent when an application is rejected. The reason is mandatory.',
    body:
      'Dear {{contactName}},\n\n' +
      'Thank you for your interest in EthioStar’s sorting service. After review, we are not able to approve the application from {{legalName}} at this time.\n\n' +
      'Reason: {{reason}}\n\n' +
      'If your circumstances change, or if you believe this decision was made on incomplete information, please contact the branch quoting reference {{reference}}.' +
      SIGN_OFF,
  },
  {
    code: T.APPLICATION_APPROVED,
    subject: 'Welcome to EthioStar — application {{reference}} approved',
    description: 'Sent on approval, before the separate credential message.',
    body:
      'Dear {{contactName}},\n\n' +
      '{{legalName}} has been approved as a registered customer of EthioStar.\n\n' +
      'Your customer code is {{customerCode}}. A separate message contains the link to set up your login.\n\n' +
      'From your dashboard you will be able to submit delivery requests, see your coffee in our custody in kilograms and kesha, track appointments and request release.' +
      SIGN_OFF,
  },
  {
    /**
     * The Stage 1 requirement: "the system automatically creates the account and emails
     * login credentials". It carries an ACTIVATION LINK, never a password — a plaintext
     * password in an inbox is a password in an inbox forever.
     */
    code: T.CUSTOMER_CREDENTIALS_ISSUED,
    subject: 'Set up your EthioStar login',
    description: 'Credential issue on customer approval. Carries a single-use activation link.',
    body:
      'Dear {{contactName}},\n\n' +
      'An account has been created for {{legalName}} on the EthioStar customer portal.\n\n' +
      'Your sign-in address is {{email}}.\n\n' +
      'Set your password here — the link can be used once and expires in {{expiryHours}} hours:\n\n' +
      '{{activationUrl}}\n\n' +
      'If the link has expired, use “Forgot password” on the sign-in page to request a new one. EthioStar staff will never ask you for your password.' +
      SIGN_OFF,
  },
  {
    code: T.DOCUMENT_EXPIRING,
    subject: 'Document expiring — {{documentName}}',
    description: 'Sent ahead of a mandatory customer document expiring.',
    body:
      'Dear {{contactName}},\n\n' +
      'The {{documentName}} we hold for {{legalName}} expires on {{expiryDate}} ({{daysRemaining}} days from today).\n\n' +
      'Once it has expired we cannot accept new delivery requests until a current copy is provided. Please upload a replacement through your portal.' +
      SIGN_OFF,
  },

  {
    code: T.DELIVERY_REQUEST_APPROVED,
    subject: 'Delivery request {{reference}} approved',
    description: 'Sent when a delivery request is approved and capacity is reserved.',
    body:
      'Dear {{contactName}},\n\n' +
      'Your delivery request {{reference}} has been approved.\n\n' +
      'Declared quantity: {{quantityKg}} kg ({{keshaCount}} kesha)\n' +
      'Expected arrival: {{expectedDate}}\n' +
      'Branch: {{branchName}}\n\n' +
      'Space has been reserved for this consignment. Please bring this reference with the vehicle.' +
      SIGN_OFF,
  },
  {
    code: T.DELIVERY_REQUEST_REJECTED,
    subject: 'Delivery request {{reference}} — not approved',
    description: 'Sent when a delivery request is rejected. Reason is mandatory.',
    body:
      'Dear {{contactName}},\n\n' +
      'We are not able to approve delivery request {{reference}} for the date requested.\n\n' +
      'Reason: {{reason}}\n\n' +
      'Please submit a new request through your portal, or contact the branch to discuss an alternative date.' +
      SIGN_OFF,
  },
  {
    code: T.COFFEE_RECEIVED,
    subject: 'Coffee received — {{consignmentReference}}',
    description: 'Sent when a goods receipt is posted at the gate.',
    body:
      'Dear {{contactName}},\n\n' +
      'Your coffee has been received into EthioStar’s custody.\n\n' +
      'Consignment: {{consignmentReference}}\n' +
      'Received: {{receivedWeightKg}} kg in {{keshaCount}} kesha\n' +
      'Goods Receiving Note: {{grnNumber}}\n' +
      'Received at: {{receivedAt}}\n\n' +
      'The weights and counts above are the figures both parties are working from. If anything differs from your records, raise it with the branch now rather than at dispatch.' +
      SIGN_OFF,
  },
  {
    code: T.STORAGE_CONFIRMED,
    subject: 'Storage confirmed — {{consignmentReference}}',
    description: 'Sent when a consignment is placed into a room and section.',
    body:
      'Dear {{contactName}},\n\n' +
      'Consignment {{consignmentReference}} has been placed in store and is now visible on your portal.\n\n' +
      'Stored: {{storedWeightKg}} kg ({{keshaCount}} kesha)\n' +
      'Placed on: {{placedAt}}\n\n' +
      'You can request processing for these lots from your dashboard at any time.' +
      SIGN_OFF,
  },

  {
    code: T.PROCESSING_REQUEST_APPROVED,
    subject: 'Processing request {{reference}} approved',
    description: 'Sent when a processing request is approved, ahead of scheduling.',
    body:
      'Dear {{contactName}},\n\n' +
      'Your request to process {{quantityKg}} kg has been approved. We will confirm an appointment shortly.' +
      SIGN_OFF,
  },
  {
    code: T.PROCESSING_REQUEST_REJECTED,
    subject: 'Processing request {{reference}} — not approved',
    description: 'Sent when a processing request is rejected. Reason is mandatory.',
    body:
      'Dear {{contactName}},\n\n' +
      'We are not able to approve processing request {{reference}} at this time.\n\n' +
      'Reason: {{reason}}\n\n' +
      'Please contact the branch if you have questions.' +
      SIGN_OFF,
  },
  {
    code: T.APPOINTMENT_SCHEDULED,
    subject: 'Processing appointment {{appointmentReference}} — {{scheduledDate}}',
    description: 'Sent when a processing appointment is allocated.',
    body:
      'Dear {{contactName}},\n\n' +
      'A processing appointment has been allocated for your coffee.\n\n' +
      'Reference: {{appointmentReference}}\n' +
      'Date: {{scheduledDate}}\n' +
      'Line: {{lineName}}\n' +
      'Quantity: {{quantityKg}} kg\n\n' +
      'We will tell you immediately if this date has to move.' +
      SIGN_OFF,
  },
  {
    /**
     * Stage 3's explicit requirement. The new date AND the reason are both mandatory
     * variables — a delay notice that does not say why is the thing customers complain
     * about, and `render` fails closed if either is missing.
     */
    code: T.APPOINTMENT_DELAYED,
    subject: 'Appointment {{appointmentReference}} moved to {{newDate}}',
    description: 'Stage 3 delay notification. New date and reason are both required.',
    body:
      'Dear {{contactName}},\n\n' +
      'Your processing appointment has had to move.\n\n' +
      'Reference: {{appointmentReference}}\n' +
      'Previous date: {{previousDate}}\n' +
      'New date: {{newDate}}\n' +
      'Reason: {{reason}}\n\n' +
      'We are sorry for the disruption. If the new date does not work for your shipment, contact the branch and we will look at what else is possible.' +
      SIGN_OFF,
  },
  {
    code: T.APPOINTMENT_CANCELLED,
    subject: 'Appointment {{appointmentReference}} cancelled',
    description: 'Sent when an appointment is cancelled rather than moved.',
    body:
      'Dear {{contactName}},\n\n' +
      'Processing appointment {{appointmentReference}}, scheduled for {{scheduledDate}}, has been cancelled.\n\n' +
      'Reason: {{reason}}\n\n' +
      'Your coffee remains in store and is unaffected. Submit a new processing request from your portal when you are ready.' +
      SIGN_OFF,
  },

  {
    code: T.PROCESSING_STARTED,
    subject: 'Processing started — {{jobReference}}',
    description: 'Sent when an operator starts a job.',
    body:
      'Dear {{contactName}},\n\n' +
      'Processing has started on job {{jobReference}}.\n\n' +
      'Input: {{inputWeightKg}} kg\n' +
      'Started at: {{startedAt}}\n\n' +
      'You will receive the output figures as soon as the job is complete.' +
      SIGN_OFF,
  },
  {
    code: T.PROCESSING_COMPLETED,
    subject: 'Processing complete — {{jobReference}}',
    description: 'Sent on job close, carrying the four-way output split.',
    body:
      'Dear {{contactName}},\n\n' +
      'Job {{jobReference}} is complete.\n\n' +
      'Input: {{inputWeightKg}} kg\n' +
      'Approved / export-ready: {{approvedKg}} kg ({{approvedPercent}}%)\n' +
      'C-grade: {{cGradeKg}} kg\n' +
      'Gravity: {{gravityKg}} kg\n' +
      'Colour sorter: {{colourSorterKg}} kg\n' +
      'Process loss: {{lossKg}} kg\n\n' +
      'The full yield and mass-balance statement is available on your portal.' +
      SIGN_OFF,
  },
  {
    code: T.OUTPUT_READY_FOR_ACCEPTANCE,
    subject: 'Outputs ready for your acceptance — {{jobReference}}',
    description: 'Sent when the acceptance pack is issued to the customer.',
    body:
      'Dear {{contactName}},\n\n' +
      'The processed outputs from job {{jobReference}} are ready for your acceptance.\n\n' +
      'Review the figures and accept them here:\n{{acceptanceUrl}}\n\n' +
      'Once accepted, the coffee is formally yours and remains in EthioStar’s store until you request release.' +
      SIGN_OFF,
  },
  {
    code: T.ACCEPTANCE_AWAITING_SIGNATURE,
    subject: 'Mirt Merekebiya {{documentNumber}} awaiting signature',
    description: 'Reminder that an issued Mirt Merekebiya has not been signed.',
    body:
      'Dear {{contactName}},\n\n' +
      'Mirt Merekebiya {{documentNumber}}, issued on {{issuedAt}}, is still awaiting your signature.\n\n' +
      'Sign it in your portal here:\n{{acceptanceUrl}}\n\n' +
      'Coffee cannot be released for dispatch until the outputs have been accepted.' +
      SIGN_OFF,
  },

  {
    code: T.DISPATCH_SCHEDULED,
    subject: 'Collection scheduled — {{dispatchReference}}',
    description: 'Sent when a release request is cleared and a collection date is set.',
    body:
      'Dear {{contactName}},\n\n' +
      'Your release request has been cleared and collection is scheduled.\n\n' +
      'Reference: {{dispatchReference}}\n' +
      'Date: {{scheduledDate}}\n' +
      'Quantity: {{quantityKg}} kg ({{keshaCount}} kesha)\n' +
      'Vehicle: {{vehiclePlate}}\n\n' +
      'The driver must present this reference at the gate.' +
      SIGN_OFF,
  },
  {
    code: T.GATE_PASS_ISSUED,
    subject: 'Gate pass {{gatePassNumber}} issued',
    description: 'Sent when a numbered, single-use gate pass is issued.',
    body:
      'Dear {{contactName}},\n\n' +
      'Gate pass {{gatePassNumber}} has been issued for the collection of {{quantityKg}} kg ({{keshaCount}} kesha).\n\n' +
      'Vehicle: {{vehiclePlate}}\n' +
      'Driver: {{driverName}}\n' +
      'Valid until: {{validUntil}}\n\n' +
      'The pass can be used once. The security officer will verify the vehicle against it at the gate.' +
      SIGN_OFF,
  },

  {
    code: T.CAPACITY_THRESHOLD_REACHED,
    subject: 'Store capacity alert — {{locationName}} at {{occupancyPercent}}%',
    description: 'Internal alert to store management as a room approaches its safe-fill limit.',
    body:
      '{{locationName}} has reached {{occupancyPercent}}% of its safe-fill capacity.\n\n' +
      'Occupied: {{occupiedKg}} kg\n' +
      'Reserved: {{reservedKg}} kg\n' +
      'Available: {{availableKg}} kg\n\n' +
      'Delivery requests against this location will be refused once available capacity reaches zero.',
  },
]

export async function seedNotificationTemplates(ctx: SeedContext): Promise<void> {
  let inserted = 0

  for (const template of TEMPLATES) {
    const result = (await ctx.tx.execute(sql`
      insert into public.notification_template (
        id, code, channel, template_version, locale,
        subject, body, variables, description, is_active,
        created_by, created_at, updated_at
      ) values (
        ${uuidv7()}, ${template.code}, 'EMAIL', 1, 'en',
        ${template.subject}, ${template.body},
        ${JSON.stringify(placeholdersIn(template))}::jsonb,
        ${template.description}, true,
        ${SYSTEM_ACTOR_ID}::uuid, now(), now()
      )
      on conflict (code, channel, locale, template_version) do nothing
      returning id
    `)) as unknown as readonly unknown[]

    if (result.length > 0) inserted += 1
  }

  ctx.log(`${TEMPLATES.length} templates declared, ${inserted} newly inserted`)
}

/** Documented placeholders, so the console shows an editor what is available. */
function placeholdersIn(template: Template): string[] {
  const found = new Set<string>()
  for (const text of [template.subject, template.body]) {
    for (const match of text.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)) {
      if (match[1]) found.add(match[1])
    }
  }
  return [...found].sort()
}
