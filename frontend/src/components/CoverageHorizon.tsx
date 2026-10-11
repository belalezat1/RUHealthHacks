import { clock } from "../lib/format";
import type { Forecast } from "../api/types";

export function CoverageHorizon({ forecast }: { forecast: Forecast }) {
  const bins = forecast.intervals ?? [];
  return (
    <div className="horizon" role="list" aria-label="90-minute coverage horizon">
      {bins.map((bin, i) => {
        const demand = Number(bin.demand_minutes ?? 0);
        const capacity = Number(bin.capacity_minutes ?? 0);
        const unmet = Number(bin.unmet_minutes ?? 0);
        const req = Math.max(1, Math.round(demand / 15));
        const avail = Math.round(capacity / 15);
        const tone =
          capacity < demand
            ? unmet >= 30 || capacity + 15 < demand
              ? "critical"
              : "caution"
            : "";
        return (
          <div key={i} className={`horizon-bin ${tone}`} role="listitem">
            <div className="t tabular">{clock(String(bin.start_at))}</div>
            <div className="cap tabular">
              {avail}
              <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>
                /{req}
              </span>
            </div>
            <div className="meta">
              {unmet > 0 ? `${unmet} uncovered min` : "Covered"}
            </div>
          </div>
        );
      })}
    </div>
  );
}