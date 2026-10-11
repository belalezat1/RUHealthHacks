import { motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../../demo/store";
import { clock, clockDate, minutesSince } from "../../lib/format";
import { IconCalendar, IconChart, IconClock } from "../Icons";
import { Card, EASE, Pill } from "../ui";

function weekday(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date(iso));
}

export function ShiftCard() {
  const { dashboard } = useDemo();
  const reduce = useReducedMotion();
  const bins = dashboard.forecast.intervals ?? [];
  const peak = Math.max(1, ...bins.map((b) => Number(b.demand_minutes ?? 0)));
  const covered = bins.filter((b) => Number(b.unmet_minutes ?? 0) === 0).length;
  const stale = Number(dashboard.freshness.stale);
  const conflicts = Number(dashboard.freshness.conflicts);

  return (
    <section className="rx-card rx-shift rx-enter" style={{ ["--i" as string]: 2 }} aria-label="Shift">
      <div className="rx-shift-head">
        Today is {weekday(dashboard.as_of)}
        <span>Evening coverage window</span>
      </div>
      <div className="rx-shift-row">
        <span className="num">
          <IconCalendar size={17} /> {clockDate(dashboard.as_of)}
        </span>
        <span className="num">
          <IconClock size={17} /> {clock(dashboard.as_of)} ET
        </span>
      </div>
      <div className="rx-shift-strip">
        <div className="rx-shift-strip-label">
          <span>Coverage, next 90 min</span>
          <span className="num">
            {covered} of {bins.length} slots covered
          </span>
        </div>
        <div className="rx-sparkbars" aria-hidden>
          {bins.map((b, i) => {
            const cap = Number(b.capacity_minutes ?? 0);
            const dem = Number(b.demand_minutes ?? 0);
            const unmet = Number(b.unmet_minutes ?? 0);
            const tone = unmet === 0 ? "" : unmet >= 30 || cap + 15 < dem ? "critical" : "caution";
            return (
              <motion.span
                key={i}
                className={tone}
                style={{ height: `${Math.max(14, (cap / peak) * 100)}%` }}
                initial={reduce ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.05, ease: EASE }}
              />
            );
          })}
        </div>
      </div>
      <div className="rx-freshness">
        <Pill tone="accent">Synthetic snapshot</Pill>
        {stale ? <Pill tone="caution">{stale} unverified signal</Pill> : null}
        {conflicts ? <Pill tone="caution">{conflicts} signal conflict</Pill> : null}
      </div>
    </section>
  );
}

function Ring({ value, total }: { value: number; total: number }) {
  const reduce = useReducedMotion();
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <svg className="rx-ring" width="52" height="52" viewBox="0 0 52 52" aria-hidden>
      <circle className="track" cx="26" cy="26" r={r} />
      <motion.circle
        className="value"
        cx="26"
        cy="26"
        r={r}
        strokeDasharray={c}
        transform="rotate(-90 26 26)"
        initial={reduce ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
      />
    </svg>
  );
}

function Units({ value, total, critical }: { value: number; total: number; critical?: boolean }) {
  return (
    <div className={`rx-units${critical ? " critical" : ""}`} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < value ? "on" : ""} />
      ))}
    </div>
  );
}

export function IndicatorsCard() {
  const { dashboard } = useDemo();
  const consults = dashboard.consultations;
  const onCall = dashboard.physicians.filter((p) => p.availability.on_shift).length;
  const waitingList = consults.filter((c) => c.status === "waiting");
  const longest = waitingList.length
    ? Math.max(...waitingList.map((c) => minutesSince(c.requested_at, dashboard.as_of)))
    : 0;
  const stroke = consults.filter((c) => c.priority === "urgent" || c.priority === "stroke").length;
  const synapse = consults.filter((c) => c.status === "in_progress" || c.status === "waiting").length;

  return (
    <Card title="Indicators" icon={<IconChart size={18} />} index={3}>
      <div className="rx-kpis">
        <div className="rx-kpi">
          <div className="rx-kpi-label">On call</div>
          <div className="rx-kpi-top">
            <div className="rx-kpi-value num">
              {onCall}
              <small>/{dashboard.physicians.length}</small>
            </div>
            <Ring value={onCall} total={dashboard.physicians.length} />
          </div>
          <div className="rx-kpi-foot">Neurologists on shift</div>
        </div>

        <div className={`rx-kpi${waitingList.length ? " is-critical" : ""}`}>
          <div className="rx-kpi-label">Waiting</div>
          <div className="rx-kpi-value num">
            {waitingList.length}
            <small>/{consults.length}</small>
          </div>
          <div className="rx-kpi-foot num">
            {waitingList.length ? `Longest wait ${longest} min` : "No consults waiting"}
          </div>
          <div className="rx-kpi-viz">
            <Units value={waitingList.length} total={consults.length} critical />
          </div>
        </div>

        <div className="rx-kpi">
          <div className="rx-kpi-label">Stroke priority</div>
          <div className="rx-kpi-value num">
            {stroke}
            <small>/{consults.length}</small>
          </div>
          <div className="rx-kpi-foot">Time-critical consults</div>
          <div className="rx-kpi-viz">
            <Units value={stroke} total={consults.length} critical />
          </div>
        </div>

        <div className="rx-kpi">
          <div className="rx-kpi-label">Synapse</div>
          <div className="rx-kpi-value num">
            {synapse}
            <small>/{consults.length}</small>
          </div>
          <div className="rx-kpi-foot">Active or ready sessions</div>
          <div className="rx-kpi-viz">
            <Units value={synapse} total={consults.length} />
          </div>
        </div>
      </div>
    </Card>
  );
}
