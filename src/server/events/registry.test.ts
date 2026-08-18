import { describe, it, expect, beforeEach } from 'vitest'
import {
  onEvent,
  onEventInline,
  inlineHandlersFor,
  deferredHandlersFor,
  subscribedEventNames,
  describeSubscriptions,
  __resetRegistry,
} from './registry'
import type { DomainEventEnvelope } from '@core/domain/domain-event'
import type { Tx } from '@db/client'

const noopInline: (e: DomainEventEnvelope, tx: Tx) => Promise<void> = async () => {}
const noopDeferred: (e: DomainEventEnvelope) => Promise<void> = async () => {}

describe('event registry — how modules stay decoupled', () => {
  beforeEach(() => {
    __resetRegistry()
  })

  it('returns an empty list for an event nobody subscribes to', () => {
    expect(inlineHandlersFor('Nothing')).toEqual([])
    expect(deferredHandlersFor('Nothing')).toEqual([])
  })

  it('keeps inline and deferred handlers in separate lanes', () => {
    onEventInline('ConsignmentReceived', 'stock', noopInline)
    onEvent('ConsignmentReceived', 'notification', noopDeferred)

    expect(inlineHandlersFor('ConsignmentReceived')).toHaveLength(1)
    expect(inlineHandlersFor('ConsignmentReceived')[0]!.module).toBe('stock')

    expect(deferredHandlersFor('ConsignmentReceived')).toHaveLength(1)
    expect(deferredHandlersFor('ConsignmentReceived')[0]!.module).toBe('notification')
  })

  it('supports several modules subscribing to one event', () => {
    // The real fan-out from ConsignmentReceived (docs 03-domain-model §3.10).
    onEventInline('ConsignmentReceived', 'consignment', noopInline)
    onEventInline('ConsignmentReceived', 'stock', noopInline)
    onEvent('ConsignmentReceived', 'notification', noopDeferred)
    onEvent('ConsignmentReceived', 'printing', noopDeferred)

    expect(inlineHandlersFor('ConsignmentReceived').map((r) => r.module)).toEqual([
      'consignment',
      'stock',
    ])
    expect(deferredHandlersFor('ConsignmentReceived').map((r) => r.module)).toEqual([
      'notification',
      'printing',
    ])
  })

  it('preserves registration order — inline effects may depend on it', () => {
    onEventInline('JobClosed', 'a', noopInline)
    onEventInline('JobClosed', 'b', noopInline)
    onEventInline('JobClosed', 'c', noopInline)
    expect(inlineHandlersFor('JobClosed').map((r) => r.module)).toEqual(['a', 'b', 'c'])
  })

  it('lists every subscribed event name, sorted', () => {
    onEvent('ZEvent', 'm', noopDeferred)
    onEventInline('AEvent', 'm', noopInline)
    expect(subscribedEventNames()).toEqual(['AEvent', 'ZEvent'])
  })

  it('describes the subscription map for diagnostics', () => {
    onEventInline('AppointmentRescheduled', 'scheduling', noopInline)
    onEvent('AppointmentRescheduled', 'notification', noopDeferred)

    expect(describeSubscriptions()).toEqual({
      AppointmentRescheduled: {
        inline: ['scheduling'],
        deferred: ['notification'],
      },
    })
  })
})
