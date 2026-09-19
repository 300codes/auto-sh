'use client'

import * as React from 'react'
import type { z } from 'zod'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export function useFlowQuery<T>(url: string, schema: z.ZodType<T>) {
  const scope = useOrganizationScopeVersion()
  const key = `${scope}:${url}`
  const sequence = React.useRef(0)
  const [state, setState] = React.useState<{ key: string; data: T | null; loading: boolean; error: boolean }>({ key, data: null, loading: true, error: false })
  const reload = React.useCallback(async () => {
    const current = ++sequence.current
    setState((previous) => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: false }))
    try {
      const response = await apiCall<unknown>(url)
      if (current !== sequence.current) return
      const parsed = schema.safeParse(response.result)
      setState({ key, data: response.ok && parsed.success ? parsed.data : null, loading: false, error: !response.ok || !parsed.success })
    } catch {
      if (current === sequence.current) setState({ key, data: null, loading: false, error: true })
    }
  }, [key, url, schema])
  React.useEffect(() => { void reload(); return () => { sequence.current += 1 } }, [reload])
  return { ...(state.key === key ? state : { data: null, loading: true, error: false }), reload }
}
