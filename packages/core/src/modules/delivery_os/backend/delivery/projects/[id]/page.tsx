import { DeliveryProjectDetailClient } from './DeliveryProjectDetailClient'

export default function DeliveryProjectDetailPage({ params }: { params: { id: string } }) {
  return <DeliveryProjectDetailClient params={params} />
}
