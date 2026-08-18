import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listCoffeeTypes,
  listCoffeeGrades,
  listScreenSizes,
  listCertifications,
  listHarvestYears,
  type CoffeeTypeRow,
  type CoffeeGradeRow,
  type ScreenSizeRow,
  type CertificationRow,
  type HarvestYearRow,
} from '@modules/master-data'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { CoffeeMasterDataClient } from './CoffeeMasterDataClient'

export const metadata: Metadata = { title: 'Coffee master data' }

/**
 * M02 — the five lookup tables behind every coffee lot: type, grade, screen size,
 * certification and harvest year. Simple `code` + name + active flag, no versioning — unlike
 * bag types, nothing here carries a value that changes over time.
 */
export default async function CoffeeMasterDataPage() {
  const { readiness } = await pageContext()

  const types = await pageQuery([] as CoffeeTypeRow[], (tx) => listCoffeeTypes(tx))
  const grades = await pageQuery([] as CoffeeGradeRow[], (tx) => listCoffeeGrades(tx))
  const screenSizes = await pageQuery([] as ScreenSizeRow[], (tx) => listScreenSizes(tx))
  const certifications = await pageQuery([] as CertificationRow[], (tx) =>
    listCertifications(tx),
  )
  const harvestYears = await pageQuery([] as HarvestYearRow[], (tx) => listHarvestYears(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coffee master data"
        description="Types, grades, screen sizes, certifications and harvest years — the controlled vocabulary a coffee lot is described with."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Lookup lists"
            description="Add a row, or deactivate one that should no longer be offered — lots already using it are unaffected."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <CoffeeMasterDataClient
            types={types}
            grades={grades}
            screenSizes={screenSizes}
            certifications={certifications}
            harvestYears={harvestYears}
          />
        </div>
      </Card>
    </div>
  )
}
