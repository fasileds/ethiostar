'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Checkbox } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { BranchOption, AdminWarehouseRow, AdminRoomRow } from '@modules/warehouse'
import { createWarehouseAction, createRoomAction, createSectionAction } from './actions'
import { WarehouseTree } from './WarehouseTree'

export function WarehousesClient({
  branches,
  warehouses,
}: {
  readonly branches: readonly BranchOption[]
  readonly warehouses: readonly AdminWarehouseRow[]
}) {
  const activeWarehouses = warehouses.filter((w) => w.isActive)
  const activeRooms = activeWarehouses.flatMap((w) =>
    w.rooms.filter((r) => r.isActive).map((r) => ({ ...r, warehouseCode: w.code })),
  )
  const lossAccountByWarehouse = new Map<string, number>()
  for (const warehouse of warehouses) {
    const count = warehouse.rooms.reduce(
      (sum, room) => sum + room.sections.filter((s) => s.isLossAccount).length,
      0,
    )
    lossAccountByWarehouse.set(warehouse.id, count)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <NewWarehouseForm branches={branches} />
        <NewRoomForm warehouses={activeWarehouses} />
        <NewSectionForm rooms={activeRooms} lossAccountByWarehouse={lossAccountByWarehouse} />
      </div>
      <WarehouseTree warehouses={warehouses} />
    </div>
  )
}

function NewWarehouseForm({ branches }: { readonly branches: readonly BranchOption[] }) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createWarehouseAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a warehouse</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <Select
        label="Branch"
        name="branchId"
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        placeholder="Choose a branch"
        error={errors.branchId}
        required
      />
      <Input
        label="Code"
        name="code"
        placeholder="ADDIS_MAIN"
        hint="Upper case, digits and underscores only."
        error={errors.code}
        required
      />
      <Input label="Name" name="nameEn" error={errors.nameEn} required />

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add warehouse'}
      </Button>
    </form>
  )
}

function NewRoomForm({ warehouses }: { readonly warehouses: readonly AdminWarehouseRow[] }) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createRoomAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a room</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <Select
        label="Warehouse"
        name="warehouseId"
        options={warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))}
        placeholder="Choose a warehouse"
        error={errors.warehouseId}
        required
      />
      <Input label="Code" name="code" placeholder="ROOM_A" error={errors.code} required />
      <Input label="Name" name="nameEn" error={errors.nameEn} required />

      <div className="grid grid-cols-3 gap-2">
        <Input label="Length (m)" name="lengthM" error={errors.lengthM} />
        <Input label="Width (m)" name="widthM" error={errors.widthM} />
        <Input label="Height (m)" name="heightM" error={errors.heightM} />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add room'}
      </Button>
    </form>
  )
}

function NewSectionForm({
  rooms,
  lossAccountByWarehouse,
}: {
  readonly rooms: readonly (AdminRoomRow & { readonly warehouseCode: string })[]
  readonly lossAccountByWarehouse: ReadonlyMap<string, number>
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createSectionAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)
  const [roomId, setRoomId] = useState('')
  const selectedRoom = rooms.find((r) => r.id === roomId)
  const existingLossAccounts = selectedRoom
    ? (lossAccountByWarehouse.get(selectedRoom.warehouseId) ?? 0)
    : 0

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a section</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <Select
        label="Room"
        name="roomId"
        options={rooms.map((r) => ({
          value: r.id,
          label: `${r.warehouseCode} / ${r.code} — ${r.name}`,
        }))}
        placeholder="Choose a room"
        error={errors.roomId}
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        required
      />
      <Input label="Code" name="code" placeholder="SEC_01" error={errors.code} required />
      <Input label="Name" name="nameEn" error={errors.nameEn} required />

      <div className="grid grid-cols-2 gap-2">
        <Input
          label="Capacity (kg)"
          name="capacityKg"
          type="number"
          step="0.001"
          min="0"
          error={errors.capacityKg}
          required
        />
        <Input
          label="Capacity (kesha)"
          name="capacityKesha"
          type="number"
          step="1"
          min="0"
          error={errors.capacityKesha}
          required
        />
      </div>

      <Checkbox
        label="This is the loss-account section for its warehouse"
        name="isLossAccount"
        value="true"
        hint={
          existingLossAccounts > 0
            ? `This warehouse already has ${existingLossAccounts} loss-account section${existingLossAccounts === 1 ? '' : 's'}. Normally there should be only one.`
            : 'The virtual section that receives process loss. Normally one per warehouse.'
        }
        error={errors.isLossAccount}
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add section'}
      </Button>
    </form>
  )
}
