import type { ReactNode } from "react";

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      {label}: <span>{value}</span>
    </div>
  );
}
