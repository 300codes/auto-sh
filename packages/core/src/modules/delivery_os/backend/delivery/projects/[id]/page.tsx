import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { DeliveryProjectDetailClient } from './DeliveryProjectDetailClient'

export default async function DeliveryProjectDetailPage({ params }: { params: { id: string } }) {
  const auth = await getAuthFromCookies()
  return <DeliveryProjectDetailClient params={params} actorUserId={auth?.sub ?? null} />
}
