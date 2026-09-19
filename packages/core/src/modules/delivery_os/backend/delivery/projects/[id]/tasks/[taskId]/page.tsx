import { DeliveryTaskDetailClient } from './DeliveryTaskDetailClient'

export default function DeliveryTaskDetailPage({ params }: { params: { id: string; taskId: string } }) {
  return <DeliveryTaskDetailClient params={params} />
}
