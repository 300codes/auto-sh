import { Suspense } from 'react'
import { DeliveryReport } from '@open-mercato/core/modules/delivery_os/components/report/DeliveryReport'

export default function DeliveryReportPage({ params }: { params: { id: string } }) {
  return <Suspense><DeliveryReport projectId={params.id} /></Suspense>
}
