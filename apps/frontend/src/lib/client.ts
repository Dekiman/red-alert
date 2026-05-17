import { hc } from 'hono/client'
import type { AppType } from '../../../backend/src/index'

// In production, we want to point directly to the worker if the proxy isn't available
const baseUrl = import.meta.env.VITE_BACKEND_TARGET || '/'
export const client = hc<AppType>(baseUrl)
