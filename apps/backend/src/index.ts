import { Hono } from 'hono'
import { cors } from 'hono/cors'
import health from './routes/health'

const app = new Hono()

export type AppType = typeof app

app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://your-frontend.vercel.app'],
}))

app.route('/api/health', health)

export default app
