/**
 * Injected time.
 *
 * Every timestamp in the system goes through a Clock. Without it, scheduling, delay
 * cascades, dwell time, reservation expiry and document numbering periods cannot be tested
 * deterministically — and they are precisely the logic that must be. A lint rule bans
 * `new Date()` and `Date.now()` outside this module and core/utils/date.
 */
export interface Clock {
  /** Current instant, always UTC. */
  now(): Date
  /** Milliseconds since the epoch. */
  timestamp(): number
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }

  timestamp(): number {
    return Date.now()
  }
}

export const systemClock: Clock = new SystemClock()

/** A clock frozen at a fixed instant. Any test calling `new Date()` is a flaky test. */
export class FrozenClock implements Clock {
  private current: Date

  constructor(instant: Date | string = '2026-08-12T09:00:00.000Z') {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant)
  }

  now(): Date {
    return new Date(this.current)
  }

  timestamp(): number {
    return this.current.getTime()
  }

  /** Move time forward — for testing expiry, ageing and delay cascades. */
  advance(ms: number): this {
    this.current = new Date(this.current.getTime() + ms)
    return this
  }

  advanceDays(days: number): this {
    return this.advance(days * 24 * 60 * 60 * 1000)
  }

  advanceHours(hours: number): this {
    return this.advance(hours * 60 * 60 * 1000)
  }

  set(instant: Date | string): this {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant)
    return this
  }
}
