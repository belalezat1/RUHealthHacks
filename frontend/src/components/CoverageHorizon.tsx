import { motion, useReducedMotion } from "framer-motion";
import { clock } from "../lib/format";
import type { Forecast } from "../api/types";

export function CoverageHorizon({ forecast }: { forecast: Forecast }) {
  const reduce = useReducedMotion();
  const bins = forecast.intervals ?? [];
  // Headroom keeps the demand line inside the track when demand is the peak.
  const peak =
    Math.max(
      15,
      ...bins.map((b) => Math.max(Number(b.demand_minutes ?? 0), Number(b.capacity_minutes ?? 0))),
    ) * 1.18;

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
            : "ok";
        return (
          <div
            key={i}
            className={`horizon-bin ${tone}`}
            role="listitem"
            aria-label={`${clock(String(bin.start_at))}: ${avail} of ${req} physicians, ${unmet > 0 ? `${unmet} uncovered minutes` : "covered"}`}
          >
            <div className="t tabular">{clock(String(bin.start_at))}</div>
            <div className="horizon-track" aria-hidden>
              <motion.div
                className="horizon-fill"
                style={{ height: `${(capacity / peak) * 100}%`, transformOrigin: "bottom" }}
                initial={reduce ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] }}
              />
              <div className="horizon-demand" style={{ bottom: `${(demand / peak) * 100}%` }} />
            </div>
            <div className="cap tabular">
              {avail}
              <span className="cap-of">/{req}</span>
            </div>
            <div className="meta">{unmet > 0 ? `${unmet} min uncovered` : "Covered"}</div>
          </div>
        );
      })}
    </div>
  );
}
