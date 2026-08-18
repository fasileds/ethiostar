import {
  LoadingRegion,
  PageHeaderSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from '@ui/patterns/Card'

/**
 * The staff loading state.
 *
 * Sits inside the shell, so the navigation and top bar stay rendered and interactive while a
 * screen streams in — someone who clicked the wrong nav item can correct it without waiting
 * for the wrong page to finish arriving.
 *
 * The shape is the shape most staff screens actually have: a header, a row of figures, then
 * a list. It is a generic stand-in rather than a per-route one because these pages already
 * degrade region-by-region through `queryOr`, and the value here is holding the layout
 * still, not predicting each screen exactly.
 */
export default function StaffLoading() {
  return (
    <LoadingRegion label="Loading page">
      <div className="space-y-7">
        <PageHeaderSkeleton />
        <StatRowSkeleton />
        <TableSkeleton rows={6} />
      </div>
    </LoadingRegion>
  )
}
