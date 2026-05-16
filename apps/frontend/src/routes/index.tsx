import { createFileRoute } from '@tanstack/react-router'
import { useDashboardStore } from '../stores/useDashboardStore'
import { StatusDot } from '../components/StatusDot'
import { Metric } from '../components/Metric'
import { AlertCard } from '../components/AlertCard'
import { NewsCard } from '../components/NewsCard'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const { 
    alerts, 
    newsEvents, 
    connectionState, 
    uiClients, 
    bufferedAlerts, 
    bufferedNewsEvents, 
    updatedAt 
  } = useDashboardStore()

  return (
    <main className="app-shell">
      <div className="interface-overlay">
        <section className="topbar topbar-floating">
          <div className="topbar-main">
            <div className="topbar-copy">
              <p className="topbar-eyebrow">Realtime watchfloor</p>
              <h1 className="title">Red Alert + Live News</h1>
              <p className="subtitle">Realtime Israeli alert state and worldwide incident flow on a live 3D globe.</p>
            </div>
            <div className="topbar-side">
              <div className="status">
                <StatusDot mode={connectionState} />
                <span>{connectionState === 'live' ? 'Connected' : 'Connecting...'}</span>
              </div>
              <div className="time-stack">
                <Metric label="Updated" value={updatedAt} />
              </div>
            </div>
          </div>
        </section>

        <aside className="overlay-panel overlay-news-panel">
          <div className="overlay-panel-head">
            <h2 className="panel-title">Live News Feed</h2>
            <span className="overlay-panel-count">{newsEvents.length}</span>
          </div>
          <div className="feed overlay-feed">
            {newsEvents.map((event) => (
              <NewsCard key={event.eventId} newsEvent={event} />
            ))}
          </div>
        </aside>

        <aside className="overlay-panel overlay-alerts-panel">
          <div className="overlay-panel-head">
            <h2 className="panel-title">Recent Red Alerts</h2>
            <span className="overlay-panel-count">{alerts.length}</span>
          </div>
          <div className="feed overlay-feed">
            {alerts.map((alert) => (
              <AlertCard key={alert.notificationId} alert={alert} />
            ))}
          </div>
        </aside>
      </div>
    </main>
  )
}
