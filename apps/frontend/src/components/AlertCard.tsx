import type { Alert } from "@red-alert/shared";
import { formatTime, hasHebrew } from "../app/text-utils";

export function AlertCard({ alert }: { alert: Alert }) {
  const hasHebrewLocation = alert.locations.some((value) => hasHebrew(value));
  const locationClassName = hasHebrewLocation ? "locations rtl" : "locations";

  return (
    <article className="card alert-card">
      <div className="card-head">
        <strong>
          {alert.locationCount} location{alert.locationCount === 1 ? "" : "s"}
        </strong>
        <span className="card-time">{formatTime(alert.alertTimestampIso)}</span>
      </div>

      <div className="tags">
        <span className="tag">Source: {alert.source}</span>
        <span className="tag">Threat: {alert.threat}</span>
        <span className="tag">Drill: {alert.isDrill ? "Yes" : "No"}</span>
        <span className="tag">ID: {alert.notificationId}</span>
      </div>

      <ul className={locationClassName}>
        {alert.locations.map((locationText, index) => (
          <li
            key={`${alert.notificationId}-${locationText}-${index}`}
            dir={hasHebrew(locationText) ? "rtl" : "ltr"}
            lang={hasHebrew(locationText) ? "he" : "en"}
          >
            {locationText}
          </li>
        ))}
      </ul>
    </article>
  );
}
