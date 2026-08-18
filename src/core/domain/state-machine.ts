import { InvalidStateTransitionError } from '../errors/app-error'

/**
 * A guarded, table-driven state machine.
 *
 * The client document's requirement: "The system will not permit a state to be skipped, and
 * every transition is logged with the user and timestamp."
 *
 * This is enforcement layer 1 of 3. The other two are the repository (which writes status
 * only alongside a history row) and a database trigger validating against a transition
 * lookup table — see docs/architecture/03-domain-model.md §3.2. The redundancy is deliberate:
 * layer 3 catches migrations, scripts and manual DBA fixes, which is exactly when the
 * discipline usually breaks.
 */

/** from-state → the states it may move to. */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>

export interface TransitionRecord<S extends string> {
  readonly from: S
  readonly to: S
  readonly at: Date
  readonly actorId: string
  readonly reason?: string | undefined
}

export class StateMachine<S extends string> {
  constructor(
    private readonly entityName: string,
    private readonly table: TransitionTable<S>,
  ) {}

  /** All states known to this machine. */
  states(): S[] {
    return Object.keys(this.table) as S[]
  }

  /** States reachable in one step from `from`. */
  allowedFrom(from: S): readonly S[] {
    return this.table[from] ?? []
  }

  can(from: S, to: S): boolean {
    return this.allowedFrom(from).includes(to)
  }

  /** A state with no outgoing transitions. */
  isTerminal(state: S): boolean {
    return this.allowedFrom(state).length === 0
  }

  /**
   * Assert a transition is legal, throwing InvalidStateTransitionError if not.
   * Callers that hold a Result-returning contract should call `can` first.
   */
  assert(from: S, to: S): void {
    if (!this.can(from, to)) {
      throw new InvalidStateTransitionError(
        this.entityName,
        from,
        to,
        this.allowedFrom(from) as readonly string[],
      )
    }
  }

  /** Assert and build the history record that must be persisted with the change. */
  transition(
    from: S,
    to: S,
    context: { at: Date; actorId: string; reason?: string | undefined },
  ): TransitionRecord<S> {
    this.assert(from, to)
    return {
      from,
      to,
      at: context.at,
      actorId: context.actorId,
      ...(context.reason !== undefined ? { reason: context.reason } : {}),
    }
  }

  /**
   * Every legal (from, to) pair, for seeding the database transition table and for
   * generating the exhaustive transition test.
   */
  legalPairs(): Array<{ from: S; to: S }> {
    const pairs: Array<{ from: S; to: S }> = []
    for (const from of this.states()) {
      for (const to of this.allowedFrom(from)) pairs.push({ from, to })
    }
    return pairs
  }

  /** Every illegal (from, to) pair — the other half of the exhaustive test. */
  illegalPairs(): Array<{ from: S; to: S }> {
    const all = this.states()
    const pairs: Array<{ from: S; to: S }> = []
    for (const from of all) {
      for (const to of all) {
        if (!this.can(from, to)) pairs.push({ from, to })
      }
    }
    return pairs
  }

  /**
   * Breadth-first shortest path between two states.
   * Used by tests and fixtures to drive an aggregate into a required state without
   * hard-coding the sequence — so adding a state does not rewrite every fixture.
   * Returns null when `to` is unreachable from `from`.
   */
  shortestPath(from: S, to: S): S[] | null {
    if (from === to) return [from]

    const queue: S[][] = [[from]]
    const seen = new Set<S>([from])

    while (queue.length > 0) {
      const path = queue.shift()
      if (!path) break
      const tail = path[path.length - 1] as S

      for (const next of this.allowedFrom(tail)) {
        if (seen.has(next)) continue
        const extended = [...path, next]
        if (next === to) return extended
        seen.add(next)
        queue.push(extended)
      }
    }

    return null
  }

  /** States that cannot be reached from `start` — catches an orphaned state in review. */
  unreachableFrom(start: S): S[] {
    return this.states().filter((s) => s !== start && this.shortestPath(start, s) === null)
  }
}

/** Build a machine from a transition table. */
export function defineStateMachine<S extends string>(
  entityName: string,
  table: TransitionTable<S>,
): StateMachine<S> {
  return new StateMachine(entityName, table)
}
