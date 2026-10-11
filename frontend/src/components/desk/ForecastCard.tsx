import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useDemo } from "../../demo/store";
import { usd } from "../../demo/economics";
import { clock, clockDate, hospitalName, physicianName, severityTone } from "../../lib/format";
import { IconClock } from "../Icons";
import { NetworkVisual } from "../NetworkVisual";
import { EASE, FolderTabs, Pill, sentence } from "../ui";

type TabId = "forecast" | "risks" | "map";

type Slot = {
  label: string;
  end: string;
  capacity: number;
  required: number;
  unmet: number;
  tone: "ok" | "caution" | "critical";
};

function toSlots(intervals: Record<string, unknown>[]): Slot[] {
  return intervals.map((bin) => {
    const demand = Number(bin.demand_minutes ?? 0);
    const capacityMin = Number(bin.capacity_minutes ?? 0);
    const unmet = Number(bin.unmet_minutes ?? 0);
    const tone: Slot["tone"] =
      capacityMin >= demand ? "ok" : unmet >= 30 || capacityMin + 15 < demand ? "critical" : "caution";
    return {
      label: clock(String(bin.start_at)),
      end: clock(String(bin.end_at)),
      capacity: Math.round(capacityMin / 15),
      required: Math.max(1, Math.round(demand / 15)),
      unmet,
      tone,
    };
  });
}

function ChartTip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload as Slot;
  return (
    <div className="rx-chart-tip">
      <strong>
        {s.label} – {s.end}
      </strong>
      <div>
        Physicians available <b className="num">{s.capacity}</b>
      </div>
      <div>
        Required for demand <b className="num">{s.required}</b>
      </div>
      {s.unmet > 0 ? <div className="gap">{s.unmet} min uncovered</div> : null}
    </div>
  );
}

function SlotDot(props: { cx?: number; cy?: number; index?: number; payload?: Slot; selected: number | null }) {
  const { cx, cy, payload, index, selected } = props;
  if (cx == null || cy == null || !payload) return null;
  const color =
    payload.tone === "critical" ? "var(--rx-danger)" : payload.tone === "caution" ? "var(--rx-warn)" : "var(--rx-ok)";
  const on = index === selected;
  return (
    <g>
      {on ? <circle cx={cx} cy={cy} r={11} fill={color} opacity={0.18} /> : null}
      <circle cx={cx} cy={cy} r={on ? 6 : 5} fill={color} stroke="var(--rx-surface)" strokeWidth={2} />
    </g>
  );
}

function Forecast() {
  const { dashboard, primary, gapMinutes, offerStep, openDecide } = useDemo();
  const reduce = useReducedMotion();
  const slots = useMemo(
    () => toSlots(dashboard.forecast.intervals as unknown as Record<string, unknown>[]),
    [dashboard.forecast.intervals],
  );
  const firstGap = slots.findIndex((s) => s.unmet > 0);
  const [selected, setSelected] = useState<number | null>(firstGap === -1 ? null : firstGap);
  const peak = Math.max(...slots.map((s) => Math.max(s.capacity, s.required)), 1) + 1;
  const showReady = primary && offerStep !== "filled";

  return (
    <>
      <div className="rx-legend">
        <span>
          <i className="swatch" aria-hidden /> Capacity <em>credentialed physicians</em>
        </span>
        <span>
          <i className="swatch demand" aria-hidden /> Demand <em>physicians needed</em>
        </span>
        <span>
          <i className="rx-dot critical" aria-hidden /> Gap
        </span>
      </div>

      <div className="rx-forecast-meta">
        <span>Next 90 minutes · 15-minute slots</span>
        <span className="num">
          {clockDate(dashboard.as_of)} · {slots[0]?.label} – {slots[slots.length - 1]?.end}
        </span>
      </div>

      <div className="rx-chart" role="img" aria-label="Capacity against demand for the next 90 minutes">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={slots}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
            onClick={(state) => {
              const i = Number(state?.activeTooltipIndex);
              if (Number.isInteger(i)) setSelected(i);
            }}
          >
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
            <YAxis
              domain={[0, peak]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={32}
              tickMargin={6}
            />
            {selected != null ? (
              <ReferenceLine x={slots[selected]?.label} stroke="var(--rx-line-strong)" strokeWidth={1} />
            ) : null}
            <Tooltip
              content={(p) => <ChartTip {...(p as TooltipContentProps<number, string>)} />}
              cursor={{ stroke: "var(--rx-line-strong)", strokeDasharray: "3 3" }}
              animationDuration={150}
            />
            <Area
              type="monotone"
              dataKey="capacity"
              stroke="var(--rx-accent)"
              strokeWidth={2.5}
              fill="var(--rx-accent)"
              fillOpacity={0.12}
              isAnimationActive={!reduce}
              animationDuration={700}
              dot={(p) => <SlotDot key={p.index} {...p} selected={selected} />}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="required"
              stroke="var(--rx-text-2)"
              strokeWidth={1.75}
              strokeDasharray="5 4"
              dot={false}
              activeDot={false}
              isAnimationActive={!reduce}
              animationDuration={700}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul className="rx-slots" aria-label="Forecast slots">
        {slots.map((s, i) => (
          <li className="rx-slot" key={s.label}>
            <button type="button" aria-pressed={selected === i} onClick={() => setSelected(i)}>
              {s.tone === "ok" ? (
                <span className="rx-dot ok" aria-hidden />
              ) : s.tone === "caution" ? (
                <span className="rx-tri" aria-hidden />
              ) : (
                <span className="rx-dot critical" aria-hidden />
              )}
              <span className="rx-slot-time num">
                {s.label} – {s.end}
              </span>
              <span className="rx-slot-cap num">
                {s.capacity} of {s.required} physicians
              </span>
              <span className={`rx-slot-gap num ${s.tone}`}>
                {s.unmet > 0 ? `${s.unmet} min uncovered` : "Covered"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <AnimatePresence initial={false}>
        {showReady ? (
          <motion.div
            className="rx-ready"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <div>
              <strong>Split-shift offer ready for review</strong>
              <span className="num">
                {physicianName(primary.candidate.physician_id, dashboard.physicians)} · {usd(primary.cost)} est. ·
                closes {Math.min(primary.minutesClosed, gapMinutes)} of {gapMinutes} min
              </span>
            </div>
            <button type="button" className="rx-btn rx-btn-primary rx-btn-sm" onClick={openDecide}>
              Review
              <span className="rx-btn-arrow" aria-hidden>
                →
              </span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Risks() {
  const { dashboard, queue, openIntervention } = useDemo();
  const risks = queue.map((q) => q.risk);
  if (!risks.length) {
    return (
      <div className="rx-empty">
        <strong>No active risks</strong>
        Every hospital meets its minimum coverage for the next 90 minutes.
      </div>
    );
  }
  return (
    <ul className="rx-risks">
      {risks.map((risk) => {
        const tone = severityTone(risk.severity);
        return (
          <li className="rx-risk" key={risk.id ?? risk.hospital_id + String(risk.reason)}>
            <span className={`rx-dot ${tone === "signal" ? "ok" : tone}`} aria-hidden />
            <div className="rx-risk-head">
              <strong>{hospitalName(risk.hospital_id, dashboard.hospitals)}</strong>
              <Pill tone={tone === "signal" ? "ok" : tone === "critical" || tone === "caution" ? tone : "muted"}>
                {sentence(String(risk.severity))}
              </Pill>
            </div>
            <div className="rx-risk-when num">
              <IconClock size={12} />
              {clock(risk.start_at)} · {clockDate(risk.start_at)}
              {risk.unmet_minutes ? ` · ${risk.unmet_minutes} min at risk` : ""}
            </div>
            <p>{risk.reason ?? risk.explanation}</p>
            <div className="rx-risk-action">
              <button
                type="button"
                className="rx-btn rx-btn-secondary rx-btn-sm"
                onClick={() => openIntervention(String(risk.id))}
              >
                Find backup
                <span className="rx-btn-arrow" aria-hidden>
                  →
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ForecastCard() {
  const { dashboard, offerStep } = useDemo();
  const [tab, setTab] = useState<TabId>("forecast");
  const reduce = useReducedMotion();
  const riskCount = dashboard.forecast.risks.length;

  return (
    <div id="forecast" className="rx-tabcard rx-section rx-enter" style={{ ["--i" as string]: 1 }}>
      <FolderTabs<TabId>
        idBase="forecast"
        label="Coverage views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "forecast", label: "Coverage forecast" },
          {
            id: "risks",
            label: "Ranked risks",
            badge: riskCount ? <span className="rx-tab-count num">{riskCount}</span> : null,
          },
          { id: "map", label: "Coverage map" },
        ]}
      />
      <div className="rx-card" style={{ borderTopLeftRadius: 0 }}>
        <div
          className="rx-card-body"
          id="forecast-panel"
          role="tabpanel"
          aria-labelledby={`forecast-tab-${tab}`}
          style={{ paddingTop: 22 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              {tab === "forecast" ? <Forecast /> : null}
              {tab === "risks" ? <Risks /> : null}
              {tab === "map" ? <NetworkVisual filled={offerStep === "filled"} /> : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
