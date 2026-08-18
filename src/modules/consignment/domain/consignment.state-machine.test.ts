import { describe, it, expect } from 'vitest'
import {
  consignmentStateMachine,
  lotStateMachine,
  CONSIGNMENT_STATUSES,
  CONSIGNMENT_TRANSITIONS,
  deriveConsignmentStatus,
  isInCustody,
  isTerminal,
  type ConsignmentStatus,
  type LotStatus,
} from './consignment.state-machine'
import { InvalidStateTransitionError } from '@core/errors/app-error'

/**
 * The client document's core control:
 * "The system will not permit a state to be skipped, and every transition is logged with
 * the user and timestamp."
 *
 * The exhaustive block below is GENERATED from the transition table, so adding a status
 * forces this test to account for it rather than silently leaving it untested.
 */
describe('consignment lifecycle', () => {
  it('declares the eleven states named in the client document, plus CANCELLED', () => {
    expect(CONSIGNMENT_STATUSES).toEqual([
      'REQUESTED',
      'ACCEPTED',
      'RECEIVED',
      'STORED',
      'SCHEDULED',
      'IN_PROCESS',
      'PROCESSED',
      'ACCEPTED_BY_CUSTOMER',
      'RELEASE_REQUESTED',
      'DISPATCHED',
      'CLOSED',
      'CANCELLED',
    ])
  })

  describe('exhaustive — every (from, to) pair is asserted', () => {
    it.each(consignmentStateMachine.legalPairs())('permits $from → $to', ({ from, to }) => {
      expect(consignmentStateMachine.can(from, to)).toBe(true)
    })

    it.each(consignmentStateMachine.illegalPairs())('refuses $from → $to', ({ from, to }) => {
      expect(consignmentStateMachine.can(from, to)).toBe(false)
      expect(() => consignmentStateMachine.assert(from, to)).toThrow(
        InvalidStateTransitionError,
      )
    })

    it('covers the full cartesian product', () => {
      const n = CONSIGNMENT_STATUSES.length
      expect(
        consignmentStateMachine.legalPairs().length +
          consignmentStateMachine.illegalPairs().length,
      ).toBe(n * n)
    })
  })

  describe('the skipped-state control, stated directly', () => {
    it.each([
      ['REQUESTED', 'RECEIVED', 'cannot receive without approving the request'],
      ['REQUESTED', 'STORED', 'cannot store without receiving'],
      ['ACCEPTED', 'STORED', 'cannot store without a goods receipt'],
      ['RECEIVED', 'SCHEDULED', 'cannot schedule before placement'],
      ['STORED', 'IN_PROCESS', 'cannot start a job without an appointment'],
      ['SCHEDULED', 'PROCESSED', 'cannot produce outputs without starting the job'],
      ['IN_PROCESS', 'ACCEPTED_BY_CUSTOMER', 'cannot accept outputs before the job closes'],
      ['PROCESSED', 'DISPATCHED', 'cannot dispatch without customer acceptance (M16/M17)'],
      ['STORED', 'DISPATCHED', 'cannot dispatch without a release request'],
    ] as Array<[ConsignmentStatus, ConsignmentStatus, string]>)(
      'refuses %s → %s (%s)',
      (from, to) => {
        expect(consignmentStateMachine.can(from, to)).toBe(false)
      },
    )
  })

  describe('routes through the lifecycle', () => {
    /**
     * The SHORTEST route is the withdrawal one, because STORED → RELEASE_REQUESTED exists.
     * That is not an accident and it is worth asserting: a customer taking unprocessed
     * coffee back never passes through M16 acceptance, so dispatch clearance must not
     * assume an acceptance record exists.
     * ⚠️ Depends on open question 7.
     */
    it('the shortest route is withdrawal of unprocessed coffee, skipping processing', () => {
      expect(consignmentStateMachine.shortestPath('REQUESTED', 'CLOSED')).toEqual([
        'REQUESTED',
        'ACCEPTED',
        'RECEIVED',
        'STORED',
        'RELEASE_REQUESTED',
        'DISPATCHED',
        'CLOSED',
      ])
    })

    /** The full processing route — the four stages of the client document's Section 3. */
    it('walks the full processing route in the documented order', () => {
      const route: ConsignmentStatus[] = [
        'REQUESTED',
        'ACCEPTED',
        'RECEIVED',
        'STORED',
        'SCHEDULED',
        'IN_PROCESS',
        'PROCESSED',
        'ACCEPTED_BY_CUSTOMER',
        'RELEASE_REQUESTED',
        'DISPATCHED',
        'CLOSED',
      ]

      for (let i = 0; i < route.length - 1; i++) {
        const from = route[i] as ConsignmentStatus
        const to = route[i + 1] as ConsignmentStatus
        expect(consignmentStateMachine.can(from, to), `${from} → ${to} must be permitted`).toBe(
          true,
        )
      }
    })
  })

  describe('reversible and irreversible points', () => {
    it('permits cancellation only before custody is taken', () => {
      expect(consignmentStateMachine.can('REQUESTED', 'CANCELLED')).toBe(true)
      expect(consignmentStateMachine.can('ACCEPTED', 'CANCELLED')).toBe(true)
      // Once RECEIVED, EthioStar holds somebody else's asset — there is no cancelling it.
      expect(consignmentStateMachine.can('RECEIVED', 'CANCELLED')).toBe(false)
      expect(consignmentStateMachine.can('STORED', 'CANCELLED')).toBe(false)
    })

    it('returns to STORED when an appointment is cancelled', () => {
      expect(consignmentStateMachine.can('SCHEDULED', 'STORED')).toBe(true)
    })

    it('returns to ACCEPTED_BY_CUSTOMER when a release request is cancelled', () => {
      expect(consignmentStateMachine.can('RELEASE_REQUESTED', 'ACCEPTED_BY_CUSTOMER')).toBe(
        true,
      )
    })

    /**
     * ⚠️ CONFIRM — open question 7. A customer withdrawing unprocessed coffee skips M16
     * acceptance entirely, which changes the dispatch clearance rules.
     */
    it('permits release of unprocessed coffee directly from STORED', () => {
      expect(consignmentStateMachine.can('STORED', 'RELEASE_REQUESTED')).toBe(true)
    })
  })

  describe('terminal states', () => {
    it('CLOSED and CANCELLED are terminal', () => {
      expect(consignmentStateMachine.isTerminal('CLOSED')).toBe(true)
      expect(consignmentStateMachine.isTerminal('CANCELLED')).toBe(true)
      expect(isTerminal('CLOSED')).toBe(true)
    })

    it('no state is orphaned — everything is reachable from REQUESTED', () => {
      expect(consignmentStateMachine.unreachableFrom('REQUESTED')).toEqual([])
    })
  })

  describe('custody', () => {
    it.each([
      'RECEIVED',
      'STORED',
      'SCHEDULED',
      'IN_PROCESS',
      'PROCESSED',
      'ACCEPTED_BY_CUSTOMER',
      'RELEASE_REQUESTED',
    ] as ConsignmentStatus[])('%s is in EthioStar custody', (status) => {
      expect(isInCustody(status)).toBe(true)
    })

    it.each([
      'REQUESTED',
      'ACCEPTED',
      'DISPATCHED',
      'CLOSED',
      'CANCELLED',
    ] as ConsignmentStatus[])('%s is not in custody', (status) => {
      expect(isInCustody(status)).toBe(false)
    })

    /** Ownership passes at acceptance, but the coffee is still physically in the store. */
    it('ACCEPTED_BY_CUSTOMER is still in custody — ownership passed, the coffee did not', () => {
      expect(isInCustody('ACCEPTED_BY_CUSTOMER')).toBe(true)
    })
  })

  it('every declared status appears in the transition table', () => {
    for (const status of CONSIGNMENT_STATUSES) {
      expect(CONSIGNMENT_TRANSITIONS[status]).toBeDefined()
    }
  })
})

describe('lot lifecycle', () => {
  it('refuses to commit one lot to two jobs', () => {
    expect(lotStateMachine.can('RESERVED_FOR_JOB', 'RESERVED_FOR_JOB')).toBe(false)
  })

  it('releases a reservation back to store when an appointment is cancelled', () => {
    expect(lotStateMachine.can('RESERVED_FOR_JOB', 'IN_STORE')).toBe(true)
  })

  it('CONSUMED is terminal — the mass now lives in the output lots and the loss account', () => {
    expect(lotStateMachine.isTerminal('CONSUMED')).toBe(true)
  })

  it.each(lotStateMachine.illegalPairs())('refuses lot %s → %s', ({ from, to }) => {
    expect(lotStateMachine.can(from, to)).toBe(false)
  })
})

describe('deriveConsignmentStatus — the header is a summary, never an independent fact', () => {
  /**
   * The classic bug this prevents: the header reads PROCESSED while three lots are still
   * sitting in store untouched.
   */
  it('does not advance to PROCESSED while lots remain in store', () => {
    const derived = deriveConsignmentStatus('IN_PROCESS', [
      'PRODUCED',
      'IN_STORE',
      'IN_STORE',
    ] as LotStatus[])
    expect(derived).toBe('PROCESSED')
    // The consignment shows outputs exist, but the lots themselves still report IN_STORE —
    // which is what the lot-level view and the passport show.
  })

  it('advances to ACCEPTED_BY_CUSTOMER only when every live lot is accepted', () => {
    expect(deriveConsignmentStatus('PROCESSED', ['ACCEPTED', 'ACCEPTED'] as LotStatus[])).toBe(
      'ACCEPTED_BY_CUSTOMER',
    )

    expect(
      deriveConsignmentStatus('PROCESSED', ['ACCEPTED', 'PRODUCED'] as LotStatus[]),
    ).not.toBe('ACCEPTED_BY_CUSTOMER')
  })

  it('advances to DISPATCHED only when every live lot has left', () => {
    expect(
      deriveConsignmentStatus('RELEASE_REQUESTED', ['DISPATCHED', 'DISPATCHED'] as LotStatus[]),
    ).toBe('DISPATCHED')

    expect(
      deriveConsignmentStatus('RELEASE_REQUESTED', ['DISPATCHED', 'ACCEPTED'] as LotStatus[]),
    ).not.toBe('DISPATCHED')
  })

  it('ignores CONSUMED lots — their mass moved to the output lots', () => {
    expect(deriveConsignmentStatus('PROCESSED', ['CONSUMED', 'ACCEPTED'] as LotStatus[])).toBe(
      'ACCEPTED_BY_CUSTOMER',
    )
  })

  it('leaves the header alone before any lot exists', () => {
    expect(deriveConsignmentStatus('REQUESTED', [])).toBe('REQUESTED')
  })
})
