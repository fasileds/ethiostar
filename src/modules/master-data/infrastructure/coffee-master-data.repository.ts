import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for the five simple coffee master-data lookup tables (M02): coffee type, coffee
 * grade, screen size, certification and harvest year. No versioning — each row is just a
 * stable `code` plus a bilingual name and an active flag, deactivated rather than deleted.
 */

export interface CoffeeTypeRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly massBalanceTolerancePct: string | null
  readonly isActive: boolean
}

export async function listCoffeeTypes(tx: Tx): Promise<CoffeeTypeRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, description, mass_balance_tolerance_pct, is_active
      from public.coffee_type
      order by sort_order, name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    description: col.textOrNull(row.description),
    massBalanceTolerancePct: col.numericOrNull(row.mass_balance_tolerance_pct),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateCoffeeTypeInput {
  readonly code: string
  readonly nameEn: string
  readonly description: string | null
  readonly massBalanceTolerancePct: string | null
  readonly actorId: string
}

export async function createCoffeeType(tx: Tx, input: CreateCoffeeTypeInput): Promise<void> {
  await tx.execute(sql`
    insert into public.coffee_type (
      id, code, name_en, description, mass_balance_tolerance_pct, sort_order, is_active,
      created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.code}, ${input.nameEn}, ${input.description},
      ${input.massBalanceTolerancePct}, 0, true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setCoffeeTypeActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.coffee_type
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export interface CoffeeGradeRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly isActive: boolean
}

export async function listCoffeeGrades(tx: Tx): Promise<CoffeeGradeRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, is_active
      from public.coffee_grade
      order by sort_order, name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateCoffeeGradeInput {
  readonly code: string
  readonly nameEn: string
  readonly actorId: string
}

export async function createCoffeeGrade(tx: Tx, input: CreateCoffeeGradeInput): Promise<void> {
  await tx.execute(sql`
    insert into public.coffee_grade (
      id, code, name_en, sort_order, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.code}, ${input.nameEn}, 0, true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setCoffeeGradeActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.coffee_grade
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export interface ScreenSizeRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly isActive: boolean
}

export async function listScreenSizes(tx: Tx): Promise<ScreenSizeRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, is_active
      from public.screen_size
      order by sort_order, name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateScreenSizeInput {
  readonly code: string
  readonly nameEn: string
  readonly actorId: string
}

export async function createScreenSize(tx: Tx, input: CreateScreenSizeInput): Promise<void> {
  await tx.execute(sql`
    insert into public.screen_size (
      id, code, name_en, sort_order, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.code}, ${input.nameEn}, 0, true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setScreenSizeActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.screen_size
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export interface CertificationRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly issuingBody: string | null
  readonly isActive: boolean
}

export async function listCertifications(tx: Tx): Promise<CertificationRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, issuing_body, is_active
      from public.certification
      order by name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    issuingBody: col.textOrNull(row.issuing_body),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateCertificationInput {
  readonly code: string
  readonly nameEn: string
  readonly issuingBody: string | null
  readonly actorId: string
}

export async function createCertification(
  tx: Tx,
  input: CreateCertificationInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.certification (
      id, code, name_en, issuing_body, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.code}, ${input.nameEn}, ${input.issuingBody}, true,
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setCertificationActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.certification
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export interface HarvestYearRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly startsOn: string
  readonly endsOn: string
  readonly isCurrent: boolean
  readonly isActive: boolean
}

export async function listHarvestYears(tx: Tx): Promise<HarvestYearRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, starts_on, ends_on, is_current, is_active
      from public.harvest_year
      order by starts_on desc
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    startsOn: col.text(row.starts_on),
    endsOn: col.text(row.ends_on),
    isCurrent: col.bool(row.is_current),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateHarvestYearInput {
  readonly code: string
  readonly nameEn: string
  readonly startsOn: string
  readonly endsOn: string
  readonly actorId: string
}

export async function createHarvestYear(tx: Tx, input: CreateHarvestYearInput): Promise<void> {
  await tx.execute(sql`
    insert into public.harvest_year (
      id, code, name_en, starts_on, ends_on, is_current, is_active,
      created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.code}, ${input.nameEn}, ${input.startsOn}::date, ${input.endsOn}::date,
      false, true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setHarvestYearActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.harvest_year
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}
