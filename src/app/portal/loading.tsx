import {
  LoadingRegion,
  PageHeaderSkeleton,
  StatRowSkeleton,
  CardSkeleton,
} from '@ui/patterns/Card'

/**
 * The customer portal loading state.
 *
 * Mirrors the portal's own shape — headline figures, then two panels — rather than reusing
 * the staff skeleton, which leads with a wide table the portal never shows.
 */
export default function PortalLoading() {
  return (
    <LoadingRegion label="Loading your coffee">
      <div className="space-y-7">
        <PageHeaderSkeleton />
        <StatRowSkeleton />
        <div className="grid gap-5 lg:grid-cols-2">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </LoadingRegion>
  )
}
