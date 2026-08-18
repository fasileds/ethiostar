import { describe, it, expect } from 'vitest'
import {
  cascadeDelay,
  assertDelayReason,
  findConflicts,
  assertNoConflict,
  describeDelay,
  type Appointment,
} from './delay-cascade'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const at = (iso: string) => new Date(iso)

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    productionLineId: 'line-1',
    consignmentId: 'cons-1',
    customerId: 'cust-1',
    scheduledStartAt: at('2026-08-13T06:00:00Z'),
    scheduledEndAt: at('2026-08-13T10:00:00Z'),
    status: 'SCHEDULED',
    ...overrides,
  }
}

/** A day's schedule on one line: three back-to-back four-hour jobs for three customers. */
function daySchedule(): Appointment[] {
  return [
    appointment({
      id: 'a1',
      customerId: 'cust-1',
      scheduledStartAt: at('2026-08-13T06:00:00Z'),
      scheduledEndAt: at('2026-08-13T10:00:00Z'),
    }),
    appointment({
      id: 'a2',
      customerId: 'cust-2',
      consignmentId: 'cons-2',
      scheduledStartAt: at('2026-08-13T10:00:00Z'),
      scheduledEndAt: at('2026-08-13T14:00:00Z'),
    }),
    appointment({
      id: 'a3',
      customerId: 'cust-3',
      consignmentId: 'cons-3',
      scheduledStartAt: at('2026-08-13T14:00:00Z'),
      scheduledEndAt: at('2026-08-13T18:00:00Z'),
    }),
  ]
}

describe('cascadeDelay — the Stage 3 requirement', () => {
  /**
   * The failure this prevents: moving one job without moving the ones behind it produces a
   * schedule that silently double-books, and the customers behind it are told nothing.
   */
  it('pushes every downstream job on the same line', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)

    expect(result.entries).toHaveLength(3)
    expect(result.entries.map((e) => e.appointmentId)).toEqual(['a1', 'a2', 'a3'])

    // Machine broke for three hours: everything moves three hours.
    expect(result.entries[0]!.newStartAt.toISOString()).toBe('2026-08-13T09:00:00.000Z')
    expect(result.entries[1]!.newStartAt.toISOString()).toBe('2026-08-13T13:00:00.000Z')
    expect(result.entries[2]!.newStartAt.toISOString()).toBe('2026-08-13T17:00:00.000Z')
  })

  it('names EVERY affected customer — the Stage 3 notification list', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)
    expect(result.affectedCustomerIds).toEqual(['cust-1', 'cust-2', 'cust-3'])
  })

  it('preserves each job’s duration through the cascade', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)

    for (const entry of result.entries) {
      const before = entry.previousEndAt.getTime() - entry.previousStartAt.getTime()
      const after = entry.newEndAt.getTime() - entry.newStartAt.getTime()
      expect(after).toBe(before)
    }
  })

  it('records how far each job moved, for the notification wording', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)
    expect(result.entries.map((e) => e.delayMinutes)).toEqual([180, 180, 180])
  })

  it('does NOT move a downstream job that still fits', () => {
    // a2 starts at 14:00, leaving a gap. A one-hour slip to a1 does not reach it.
    const schedule = [
      appointment({
        id: 'a1',
        scheduledStartAt: at('2026-08-13T06:00:00Z'),
        scheduledEndAt: at('2026-08-13T10:00:00Z'),
      }),
      appointment({
        id: 'a2',
        customerId: 'cust-2',
        scheduledStartAt: at('2026-08-13T14:00:00Z'),
        scheduledEndAt: at('2026-08-13T18:00:00Z'),
      }),
    ]

    const result = cascadeDelay(schedule[0]!, at('2026-08-13T07:00:00Z'), schedule)
    expect(result.entries).toHaveLength(1)
    expect(result.affectedCustomerIds).toEqual(['cust-1'])
  })

  it('absorbs the delay partly into a gap, moving only what collides', () => {
    const schedule = [
      appointment({
        id: 'a1',
        scheduledStartAt: at('2026-08-13T06:00:00Z'),
        scheduledEndAt: at('2026-08-13T10:00:00Z'),
      }),
      appointment({
        id: 'a2',
        customerId: 'cust-2',
        scheduledStartAt: at('2026-08-13T11:00:00Z'),
        scheduledEndAt: at('2026-08-13T15:00:00Z'),
      }),
    ]

    // a1 slips two hours → ends 12:00, which now collides with a2's 11:00 start.
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T08:00:00Z'), schedule)
    expect(result.entries).toHaveLength(2)
    expect(result.entries[1]!.newStartAt.toISOString()).toBe('2026-08-13T12:00:00.000Z')
    // a2 moved only one hour, not two — the gap absorbed the rest.
    expect(result.entries[1]!.delayMinutes).toBe(60)
  })

  it('leaves other production lines alone', () => {
    const schedule = [
      appointment({ id: 'a1', productionLineId: 'line-1' }),
      appointment({
        id: 'b1',
        productionLineId: 'line-2',
        customerId: 'cust-9',
        scheduledStartAt: at('2026-08-13T06:00:00Z'),
        scheduledEndAt: at('2026-08-13T10:00:00Z'),
      }),
    ]
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)
    expect(result.entries.map((e) => e.appointmentId)).toEqual(['a1'])
  })

  /** A job already on the line is physically running; it cannot be pushed. */
  it('does not move a job that is already IN_PROGRESS', () => {
    const schedule = [
      appointment({
        id: 'a1',
        scheduledStartAt: at('2026-08-13T06:00:00Z'),
        scheduledEndAt: at('2026-08-13T10:00:00Z'),
      }),
      appointment({
        id: 'a2',
        customerId: 'cust-2',
        status: 'IN_PROGRESS',
        scheduledStartAt: at('2026-08-13T10:00:00Z'),
        scheduledEndAt: at('2026-08-13T14:00:00Z'),
      }),
    ]
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T09:00:00Z'), schedule)
    expect(result.entries.map((e) => e.appointmentId)).toEqual(['a1'])
  })

  it('supports bringing a job forward', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T05:00:00Z'), schedule)
    expect(result.entries[0]!.delayMinutes).toBe(-60)
    // Downstream jobs still fit, so nothing else moves.
    expect(result.entries).toHaveLength(1)
  })

  it('is a no-op when the time does not change', () => {
    const schedule = daySchedule()
    const result = cascadeDelay(schedule[0]!, at('2026-08-13T06:00:00Z'), schedule)
    expect(result.entries).toEqual([])
    expect(result.affectedCustomerIds).toEqual([])
  })

  it('refuses to reschedule an appointment that is not SCHEDULED', () => {
    expect(() =>
      cascadeDelay(appointment({ status: 'COMPLETED' }), at('2026-08-13T09:00:00Z'), []),
    ).toThrow(BusinessRuleViolation)
  })
})

describe('assertDelayReason — without it the delay-by-cause report cannot be produced', () => {
  it('requires a reason code', () => {
    try {
      assertDelayReason(null, null)
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.DELAY_REASON_REQUIRED)
    }
  })

  it('accepts a reason code alone', () => {
    expect(() => assertDelayReason('DELAY_MACHINE', null)).not.toThrow()
  })

  it('rejects a blank narrative where one is required', () => {
    expect(() => assertDelayReason('DELAY_OTHER', '   ')).toThrow(BusinessRuleViolation)
  })

  it('accepts a real narrative', () => {
    expect(() =>
      assertDelayReason('DELAY_OTHER', 'Power cut across the compound.'),
    ).not.toThrow()
  })
})

describe('findConflicts — mirrors the EXCLUDE constraint on appointment', () => {
  const existing = daySchedule()

  it('detects an overlapping booking', () => {
    const conflicts = findConflicts(
      {
        productionLineId: 'line-1',
        startAt: at('2026-08-13T09:00:00Z'),
        endAt: at('2026-08-13T11:00:00Z'),
      },
      existing,
    )
    expect(conflicts.map((c) => c.id)).toEqual(['a1', 'a2'])
  })

  it('permits a back-to-back slot (half-open range)', () => {
    expect(
      findConflicts(
        {
          productionLineId: 'line-1',
          startAt: at('2026-08-13T18:00:00Z'),
          endAt: at('2026-08-13T22:00:00Z'),
        },
        existing,
      ),
    ).toEqual([])
  })

  it('ignores other lines', () => {
    expect(
      findConflicts(
        {
          productionLineId: 'line-2',
          startAt: at('2026-08-13T06:00:00Z'),
          endAt: at('2026-08-13T10:00:00Z'),
        },
        existing,
      ),
    ).toEqual([])
  })

  it('ignores cancelled appointments', () => {
    const withCancelled = [
      appointment({
        id: 'x',
        status: 'CANCELLED',
        scheduledStartAt: at('2026-08-14T06:00:00Z'),
        scheduledEndAt: at('2026-08-14T10:00:00Z'),
      }),
    ]
    expect(
      findConflicts(
        {
          productionLineId: 'line-1',
          startAt: at('2026-08-14T06:00:00Z'),
          endAt: at('2026-08-14T10:00:00Z'),
        },
        withCancelled,
      ),
    ).toEqual([])
  })

  it('excludes the appointment being edited', () => {
    expect(
      findConflicts(
        {
          productionLineId: 'line-1',
          startAt: at('2026-08-13T06:00:00Z'),
          endAt: at('2026-08-13T10:00:00Z'),
          excludeId: 'a1',
        },
        existing,
      ),
    ).toEqual([])
  })

  it('assertNoConflict names the clashing appointments', () => {
    try {
      assertNoConflict(
        {
          productionLineId: 'line-1',
          startAt: at('2026-08-13T09:00:00Z'),
          endAt: at('2026-08-13T11:00:00Z'),
        },
        existing,
      )
      expect.unreachable()
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.APPOINTMENT_OVERLAP)
      expect(e.details?.conflictingAppointmentIds).toEqual(['a1', 'a2'])
    }
  })
})

describe('describeDelay — wording for the customer notification', () => {
  const entry = (minutes: number) => ({
    appointmentId: 'a',
    customerId: 'c',
    consignmentId: 'cn',
    previousStartAt: at('2026-08-13T06:00:00Z'),
    previousEndAt: at('2026-08-13T10:00:00Z'),
    newStartAt: at('2026-08-13T09:00:00Z'),
    newEndAt: at('2026-08-13T13:00:00Z'),
    delayMinutes: minutes,
    isOrigin: true,
  })

  it('describes hours and minutes', () => {
    expect(describeDelay(entry(180))).toBe('Moved later by 3 hours')
    expect(describeDelay(entry(90))).toBe('Moved later by 1 hour 30 minutes')
    expect(describeDelay(entry(45))).toBe('Moved later by 45 minutes')
  })

  it('describes bringing a job forward', () => {
    expect(describeDelay(entry(-60))).toBe('Brought forward by 1 hour')
  })
})
