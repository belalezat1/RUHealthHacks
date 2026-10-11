import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { buildDemoDashboard, demoRecommendation } from "../../demo/snapshot";
import { rankCandidates, usd } from "../../demo/economics";
import { clock, hospitalName, minutesUntil, physicianName } from "../../lib/format";
import { IconCheck } from "../Icons";
import { Avatar, EASE, Pill, WorkflowSteps, type FlowStage } from "../ui";

/**
 * A live miniature of the coverage desk, built from the same demo snapshot the
 * app uses. `stage` follows the hero headline (Detect → Decide → Act) and
 * highlights the part of the product that does that job.
 */
export function ProductPreview({ stage }: { stage: 0 | 1 | 2 }) {
  const reduce = useReducedMotion();
  const data = useMemo(() => {
    const d = buildDemoDashboard();
    const risk = d.forecast.risks[0];
    const best = rankCandidates([demoRecommendation.candidate, ...demoRecommendation.alternatives], "cost")[0];
    return {
      d,
      risk,
      best,
      mins: minutesUntil(String(risk.start_at), d.as_of),
      rules: best.candidate.eligibility?.rules?.length ?? 0,
    };
  }, []);

  const { d, risk, best, mins, rules } = data;
  const bins = d.forecast.intervals;
  const W = 440;
  const H = 120;
  const peak = 4;
  const x = (i: number) => 14 + (i * (W - 28)) / (bins.length - 1);
  const y = (v: number) => H - 12 - (v / peak) * (H - 28);
  const cap = bins.map((b) => Number(b.capacity_minutes ?? 0) / 15);
  const dem = bins.map((b) => Number(b.demand_minutes ?? 0) / 15);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line(cap)} L${x(cap.length - 1)},${H - 12} L${x(0)},${H - 12} Z`;
  const name = physicianName(best.candidate.physician_id, d.physicians);

  return (
    <div className="lp-preview" aria-label="Relay coverage desk preview" role="img">
      <div className="lp-preview-bar">
        <span className="lp-preview-title">Coverage desk</span>
        <span className="lp-preview-time num">
          <i aria-hidden /> Live · {clock(d.as_of)} ET
        </span>
      </div>

      <div className={`lp-preview-block${stage === 0 ? " is-focus" : ""}`}>
        <div className="lp-preview-alert">
          <div className="lp-preview-clock">
            <strong className="num">{mins}</strong>
            <span>min to gap</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <Pill tone="critical" dot>
              Critical risk
            </Pill>
            <p className="lp-preview-head">{hospitalName(risk.hospital_id, d.hospitals)}</p>
            <p className="lp-preview-sub">Shift ends while stroke demand rises</p>
          </div>
        </div>
        <svg className="lp-preview-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          {[1, 2, 3].map((v) => (
            <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--rx-line)" strokeWidth={1} />
          ))}
          <motion.path
            d={area}
            fill="var(--rx-accent)"
            fillOpacity={0.12}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
          />
          <motion.path
            d={line(cap)}
            fill="none"
            stroke="var(--rx-accent)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: EASE }}
          />
          <path d={line(dem)} fill="none" stroke="var(--rx-text-3)" strokeWidth={1.5} strokeDasharray="5 4" />
          {cap.map((v, i) => (
            <motion.circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={4.5}
              fill={v >= dem[i] ? "var(--rx-ok)" : v + 1 < dem[i] ? "var(--rx-danger)" : "var(--rx-warn)"}
              stroke="var(--rx-surface)"
              strokeWidth={2}
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              style={{ transformOrigin: `${x(i)}px ${y(v)}px` }}
              transition={{ duration: 0.3, delay: 0.5 + i * 0.08, ease: EASE }}
            />
          ))}
        </svg>
      </div>

      <div className={`lp-preview-block lp-preview-offer${stage === 1 ? " is-focus" : ""}`}>
        <Avatar name={name} seed={best.candidate.physician_id} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="lp-preview-head">
            {name} <Pill tone="accent">Offer first</Pill>
          </p>
          <p className="lp-preview-sub num">
            {best.years} yrs · passes {rules}/{rules} rules · lowest cost
          </p>
        </div>
        <strong className="lp-preview-cost num">{usd(best.cost)}</strong>
      </div>

      <div className={`lp-preview-block lp-preview-act${stage === 2 ? " is-focus" : ""}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={stage === 2 ? "sent" : "pending"}
            className={`lp-preview-status${stage === 2 ? " is-done" : ""}`}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            {stage === 2 ? (
              <>
                <IconCheck size={15} strokeWidth={2.4} /> Approved by clinical lead · offer sent
              </>
            ) : (
              "Awaiting human approval"
            )}
          </motion.span>
        </AnimatePresence>
        <WorkflowSteps stage={stage as FlowStage} />
      </div>
    </div>
  );
}
