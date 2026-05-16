import { Hono } from 'hono'
import { parseEnv } from '../env'

const router = new Hono()

router.get('/', (c) => {
  const env = parseEnv(c.env);
  return c.json({ ok: true, timezone: env.RED_ALERT_TIMEZONE })
})

export default router
