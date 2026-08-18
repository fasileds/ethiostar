'use client'

import { useState } from 'react'
import { Button } from '@ui/primitives/Button'
import type { ActionResult } from '@server/actions/action-result'
import type { AdminWarehouseRow, AdminRoomRow, AdminSectionRow } from '@modules/warehouse'
import {
  setWarehouseActiveAction,
  setRoomActiveAction,
  setSectionActiveAction,
} from './actions'

export function WarehouseTree({
  warehouses,
}: {
  readonly warehouses: readonly AdminWarehouseRow[]
}) {
  if (warehouses.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No warehouses yet. Add the first one above.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {warehouses.map((warehouse) => (
        <div
          key={warehouse.id}
          className="rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]"
        >
          <div className="flex flex-wrap items-center gap-3 bg-[var(--surface-sunken)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[var(--text-tertiary)]">
                  {warehouse.code}
                </span>
                <span className="font-semibold">{warehouse.name}</span>
                <InactiveBadge isActive={warehouse.isActive} />
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                {warehouse.branchName}
              </p>
            </div>
            <ToggleButton
              id={warehouse.id}
              isActive={warehouse.isActive}
              action={setWarehouseActiveAction}
            />
          </div>

          {warehouse.rooms.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--text-tertiary)]">No rooms yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {warehouse.rooms.map((room) => (
                <RoomRow key={room.id} room={room} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

function RoomRow({ room }: { readonly room: AdminRoomRow }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--text-tertiary)]">{room.code}</span>
            <span className="font-medium">{room.name}</span>
            <InactiveBadge isActive={room.isActive} />
          </div>
          {room.lengthM || room.widthM || room.heightM ? (
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {room.lengthM ?? '—'} × {room.widthM ?? '—'} × {room.heightM ?? '—'} m
            </p>
          ) : null}
        </div>
        <ToggleButton id={room.id} isActive={room.isActive} action={setRoomActiveAction} />
      </div>

      {room.sections.length > 0 ? (
        <ul className="mt-2 space-y-1.5 pl-4">
          {room.sections.map((section) => (
            <SectionRow key={section.id} section={section} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function SectionRow({ section }: { readonly section: AdminSectionRow }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{section.code}</span>
          <span className="text-sm font-medium">{section.name}</span>
          <InactiveBadge isActive={section.isActive} />
          {section.isLossAccount ? (
            <span className="rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100">
              Loss account
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          {section.capacityKg} kg · {section.capacityKesha} kesha
        </p>
      </div>
      <ToggleButton
        id={section.id}
        isActive={section.isActive}
        action={setSectionActiveAction}
      />
    </li>
  )
}

function InactiveBadge({ isActive }: { readonly isActive: boolean }) {
  if (isActive) return null
  return (
    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      Inactive
    </span>
  )
}

function ToggleButton({
  id,
  isActive,
  action,
}: {
  readonly id: string
  readonly isActive: boolean
  readonly action: (formData: FormData) => Promise<ActionResult<void>>
}) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', id)
    formData.set('isActive', String(!isActive))
    await action(formData)
    setPending(false)
  }

  return (
    <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
      {isActive ? 'Deactivate' : 'Activate'}
    </Button>
  )
}
