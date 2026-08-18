import { describe, it, expect } from 'vitest'
import { defineStateMachine, type TransitionTable } from './state-machine'
import { InvalidStateTransitionError } from '../errors/app-error'

type S = 'DRAFT' | 'ACTIVE' | 'DONE' | 'CANCELLED' | 'ORPHAN'

const table: TransitionTable<S> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
  ORPHAN: ['DONE'],
}

const sm = defineStateMachine<S>('Thing', table)

describe('StateMachine', () => {
  it('permits declared transitions', () => {
    expect(sm.can('DRAFT', 'ACTIVE')).toBe(true)
    expect(sm.can('ACTIVE', 'DONE')).toBe(true)
  })

  it('refuses a skipped state — the client document’s core control', () => {
    expect(sm.can('DRAFT', 'DONE')).toBe(false)
    expect(() => sm.assert('DRAFT', 'DONE')).toThrow(InvalidStateTransitionError)
  })

  it('refuses to leave a terminal state', () => {
    expect(sm.isTerminal('DONE')).toBe(true)
    expect(sm.can('DONE', 'ACTIVE')).toBe(false)
  })

  it('refuses a self-transition unless declared', () => {
    expect(sm.can('ACTIVE', 'ACTIVE')).toBe(false)
  })

  it('reports the allowed set in the error, so the UI can explain', () => {
    try {
      sm.assert('DRAFT', 'DONE')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError)
      const e = error as InvalidStateTransitionError
      expect(e.details).toMatchObject({
        entity: 'Thing',
        from: 'DRAFT',
        to: 'DONE',
        allowed: ['ACTIVE', 'CANCELLED'],
      })
    }
  })

  it('builds the history record that must be persisted with the change', () => {
    const at = new Date('2026-08-12T09:00:00Z')
    const record = sm.transition('DRAFT', 'ACTIVE', {
      at,
      actorId: 'user-1',
      reason: 'approved',
    })
    expect(record).toEqual({
      from: 'DRAFT',
      to: 'ACTIVE',
      at,
      actorId: 'user-1',
      reason: 'approved',
    })
  })

  it('omits reason when not supplied (exactOptionalPropertyTypes)', () => {
    const record = sm.transition('DRAFT', 'ACTIVE', {
      at: new Date('2026-08-12T09:00:00Z'),
      actorId: 'user-1',
    })
    expect('reason' in record).toBe(false)
  })

  describe('exhaustive coverage — every (from, to) pair is asserted', () => {
    // Generated from the table, so adding a state forces this test to be updated.
    const all = sm.states()

    it.each(sm.legalPairs())('permits $from → $to', ({ from, to }) => {
      expect(sm.can(from, to)).toBe(true)
      expect(() => sm.assert(from, to)).not.toThrow()
    })

    it.each(sm.illegalPairs())('refuses $from → $to', ({ from, to }) => {
      expect(sm.can(from, to)).toBe(false)
      expect(() => sm.assert(from, to)).toThrow(InvalidStateTransitionError)
    })

    it('covers the full cartesian product', () => {
      expect(sm.legalPairs().length + sm.illegalPairs().length).toBe(all.length ** 2)
    })
  })

  describe('shortestPath — drives fixtures without hard-coded sequences', () => {
    it('finds the path', () => {
      expect(sm.shortestPath('DRAFT', 'DONE')).toEqual(['DRAFT', 'ACTIVE', 'DONE'])
    })

    it('returns the single state when start equals target', () => {
      expect(sm.shortestPath('DRAFT', 'DRAFT')).toEqual(['DRAFT'])
    })

    it('returns null when unreachable', () => {
      expect(sm.shortestPath('DONE', 'DRAFT')).toBeNull()
      expect(sm.shortestPath('DRAFT', 'ORPHAN')).toBeNull()
    })
  })

  it('detects an orphaned state — catches a modelling slip in review', () => {
    expect(sm.unreachableFrom('DRAFT')).toEqual(['ORPHAN'])
  })
})
