import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M04 — template rendering.
 *
 * Pure: no database, no clock, no I/O. The rendered result is what gets persisted in
 * `notification.rendered_body`, which is the evidentiary record — "what EthioStar told a
 * customer and when". Rendering must therefore be reproducible from the stored template
 * version and the stored payload, with nothing ambient mixed in.
 */

/** `{{ name }}` — whitespace tolerated, because template authors are not programmers. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

export interface TemplateSource {
  readonly code: string
  readonly subject: string | null
  readonly body: string
}

export interface RenderedMessage {
  readonly subject: string | null
  readonly body: string
}

export type TemplateVariables = Readonly<Record<string, string | number | null | undefined>>

/** Every placeholder the template references, deduplicated and in first-appearance order. */
export function placeholdersOf(template: TemplateSource): string[] {
  const seen = new Set<string>()
  for (const text of [template.subject ?? '', template.body]) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1]
      if (name) seen.add(name)
    }
  }
  return [...seen]
}

/**
 * Substitute variables into a template.
 *
 * A MISSING variable is a hard failure, not a blank. The alternative — leaving `{{ }}` in
 * place or silently substituting an empty string — produces "Dear , your appointment on
 * has moved", which is worse than no message at all: the customer learns nothing and
 * EthioStar's evidentiary log records that it told them nothing.
 *
 * Failing here means the outbox retries and eventually dead-letters, which raises an alert
 * a person can act on. That is the correct place for this to surface.
 *
 * A variable supplied but not referenced is fine — templates are edited by staff and losing
 * a placeholder should not break the sending code that still passes it.
 */
export function render(
  template: TemplateSource,
  variables: TemplateVariables,
): RenderedMessage {
  const missing: string[] = []

  const substitute = (text: string): string =>
    text.replace(PLACEHOLDER, (_match, name: string) => {
      const value = variables[name]
      if (value === undefined || value === null) {
        missing.push(name)
        return ''
      }
      return String(value)
    })

  const subject = template.subject === null ? null : substitute(template.subject)
  const body = substitute(template.body)

  if (missing.length > 0) {
    throw new BusinessRuleViolation(ERROR_CODES.NOTIFICATION_TEMPLATE_NOT_FOUND, {
      message: `Template "${template.code}" is missing values for: ${[...new Set(missing)].join(', ')}.`,
      details: { templateCode: template.code, missing: [...new Set(missing)] },
    })
  }

  return { subject, body }
}
