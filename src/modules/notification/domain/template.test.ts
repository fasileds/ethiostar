import { describe, it, expect } from 'vitest'
import { render, placeholdersOf, type TemplateSource } from './template'

const template = (body: string, subject: string | null = null): TemplateSource => ({
  code: 'TEST',
  subject,
  body,
})

describe('placeholdersOf', () => {
  it('finds placeholders in both subject and body, deduplicated', () => {
    const found = placeholdersOf(
      template('Dear {{name}}, your {{item}} is ready. Thank you {{name}}.', 'About {{item}}'),
    )
    expect(found).toEqual(['item', 'name'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(placeholdersOf(template('{{  name  }}'))).toEqual(['name'])
  })

  it('returns nothing for a template with no placeholders', () => {
    expect(placeholdersOf(template('Your coffee has arrived.'))).toEqual([])
  })
})

describe('render', () => {
  it('substitutes every placeholder in subject and body', () => {
    const result = render(template('Dear {{name}}, {{count}} kesha received.', 'GRN {{ref}}'), {
      name: 'Abebe Trading',
      count: 120,
      ref: 'GRN-2026-000045',
    })

    expect(result.subject).toBe('GRN GRN-2026-000045')
    expect(result.body).toBe('Dear Abebe Trading, 120 kesha received.')
  })

  it('keeps a null subject null', () => {
    expect(render(template('body', null), {}).subject).toBeNull()
  })

  it('accepts variables the template does not reference', () => {
    const result = render(template('Hello {{name}}.'), { name: 'Abebe', unused: 'x' })
    expect(result.body).toBe('Hello Abebe.')
  })

  it('substitutes the same placeholder everywhere it appears', () => {
    const result = render(template('{{n}} in, {{n}} out'), { n: 5 })
    expect(result.body).toBe('5 in, 5 out')
  })

  /**
   * The control that matters. A blank in a customer-facing message is worse than a failure:
   * the outbox retries and dead-letters a failure, which alerts a person, whereas a blank is
   * delivered and believed.
   */
  it('refuses to render when a referenced variable is missing', () => {
    expect(() => render(template('Dear {{name}}, on {{date}}.'), { name: 'Abebe' })).toThrow(
      /missing values for: date/,
    )
  })

  it('treats an explicit null as missing', () => {
    expect(() => render(template('Dear {{name}}.'), { name: null })).toThrow(/name/)
  })

  it('names every missing variable at once, so one fix round-trip is enough', () => {
    expect(() => render(template('{{a}} {{b}} {{c}}'), { b: 'ok' })).toThrow(
      /missing values for: a, c/,
    )
  })

  it('reports a missing variable only once however often it appears', () => {
    expect(() => render(template('{{a}} {{a}} {{a}}'), {})).toThrow(/missing values for: a\./)
  })

  it('renders a zero without treating it as absent', () => {
    expect(render(template('{{n}} kg'), { n: 0 }).body).toBe('0 kg')
  })
})
