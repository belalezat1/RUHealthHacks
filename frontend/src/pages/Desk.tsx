import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ConsultBoard } from "../components/ConsultBoard";
import { CoverageHorizon } from "../components/CoverageHorizon";
import { EligibilityMatrix } from "../components/EligibilityMatrix";
import { NetworkVisual } from "../components/NetworkVisual";
import { OfferEconomics } from "../components/OfferEconomics";
import { OfferLoop } from "../components/OfferLoop";
import { Reveal } from "../components/Reveal";
import { IconAlert, IconClock } from "../components/Icons";
import { useDemo } from "../demo/store";
import { experienceOf, seniority } from "../demo/economics";
import {
  clock,
  clockDate,
  hospitalName,
  minutesUntil,
  physicianName,
  severityTone,
} from "../lib/format";

function StatTile({
  value,
  total,
  label,
  accent,
  delay,
}: {
  value: number;
  total: number;
  label: string;
  accent?: boolean;
  delay: number;
}) {
  const reduce = useReducedMotion();
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <Reveal as="div" className={`stat-tile${accent ? " stat-tile-accent" : ""}`} delay={delay}>
      <div className="stat-top">
        <div className="n tabular">{value}</div>
        <div className="stat-of tabular">of {total}</div>
      </div>
      <div className="l">{label}</div>
      <div className="stat-meter" aria-hidden>
        <motion.span
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, delay: delay + 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Reveal>
  );
}

export default function Desk() {
  const demo = useDemo();
  const { dashboard, recommendation, panel, setPanel, openDecide, offerStep, lastFill } = demo;
  const topRisk = dashboard.forecast.risks[0];
  const filled = offerStep === "filled";
  const partial = filled && lastFill != null && lastFill.minutesClosed < lastFill.gapMinutes;

  useEffect(() => {
    if (sessionStorage.getItem("sevaro-open-decide") === "1") {
      sessionStorage.removeItem("sevaro-open-decide");
      openDecide();
    }
  }, [openDecide]);

  const consults = dashboard.consultations;
  const waiting = consults.filter((c) => c.status === "waiting").length;
  const onCall = dashboard.physicians.filter((p) => p.availability.on_shift).length;
  const urgent = consults.filter((c) => c.priority === "urgent" || c.priority === "stroke").length;
  const synapseLive = consults.filter(
    (c) => c.status === "in_progress" || c.status === "waiting",
  ).length;

  const gapMins = topRisk?.start_at
    ? Math.max(1, Math.min(90, minutesUntil(String(topRisk.start_at), dashboard.as_of)))
    : null;

  return (
    <div className="desk">
      {filled && lastFill ? (
        <motion.div
          className={partial ? "partial-banner" : "success-banner"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
        >
          <strong>
            {partial
              ? `Riverfront gap reduced: ${lastFill.gapMinutes - lastFill.minutesClosed} min still uncovered`
              : "Coverage restored at Riverfront"}
          </strong>
          <p style={{ margin: "8px 0 0", color: "var(--text-soft)" }}>
            {physicianName(lastFill.physicianId, dashboard.physicians)} accepted and closes{" "}
            {lastFill.minutesClosed} of {lastFill.gapMinutes} uncovered minutes.
            {partial
              ? " Review the remaining risk before offering more cover."
              : " Offers stopped. Projected capacity meets the minimum for the next 90 minutes."}
          </p>
        </motion.div>
      ) : (
        <section className="insight insight-solo" aria-labelledby="insight-title">
          {topRisk && gapMins != null ? (
            <div className="countdown" aria-hidden>
              <span className="countdown-live">
                <i /> Live
              </span>
              <span className="countdown-n tabular">{gapMins}</span>
              <span className="countdown-l">min to gap</span>
            </div>
          ) : null}
          <div className="insight-copy">
            <p className="insight-kicker">
              {topRisk ? `${String(topRisk.severity).toUpperCase()} RISK` : "ALL CLEAR"}
            </p>
            <h1 id="insight-title">
              {topRisk && gapMins != null
                ? `Coverage gap in ${gapMins} min at ${hospitalName(topRisk.hospital_id, dashboard.hospitals)}`
                : "Network stable for the next 90 minutes"}
            </h1>
            <p>{topRisk?.reason ?? "No ranked coverage risks in the forecast horizon."}</p>
            <p className="insight-next">
              Next: review eligibility, then approve the lowest-cost eligible offer.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => openDecide()}>
            Review intervention
            <span className="btn-arrow" aria-hidden>→</span>
          </button>
        </section>
      )}

      <div className="stat-strip" aria-label="Live stats">
        <StatTile value={onCall} total={dashboard.physicians.length} label="Neurologists on call" delay={0} />
        <StatTile value={waiting} total={consults.length} label="Consults waiting" delay={0.05} />
        <StatTile value={urgent} total={consults.length} label="Stroke-priority" accent delay={0.1} />
        <StatTile value={synapseLive} total={consults.length} label="Synapse pathways" delay={0.15} />
      </div>

      <Reveal className="panel">
        <div className="panel-head">
          <div>
            <h2>Next 90 minutes</h2>
            <p>Credentialed neurology capacity vs consult demand · 15-minute slots</p>
          </div>
          <div className="horizon-legend" aria-hidden>
            <span><i className="lg-cap" /> Capacity</span>
            <span><i className="lg-demand" /> Demand</span>
          </div>
        </div>
        <CoverageHorizon forecast={dashboard.forecast} />
      </Reveal>

      <Reveal className="panel" aria-labelledby="econ-title">
        <div className="panel-head">
          <div>
            <h2 id="econ-title">Offer economics</h2>
            <p>Eligible physicians by estimated split-shift cost · experience on every row</p>
          </div>
          <span className="pill pill-signal">Cheapest eligible first</span>
        </div>
        <OfferEconomics />
      </Reveal>

      <div className="desk-grid">
        <Reveal className="panel">
          <div className="panel-head">
            <div>
              <h2>Consult board</h2>
              <p>Stroke vs routine · wait time · Synapse session</p>
            </div>
          </div>
          <ConsultBoard
            consultations={dashboard.consultations}
            hospitals={dashboard.hospitals}
            asOf={dashboard.as_of}
          />
        </Reveal>

        <Reveal className="panel" delay={0.06}>
          <div className="panel-head">
            <div>
              <h2>Ranked risks</h2>
              <p>Plain-language coverage reasons</p>
            </div>
            <span className="pill pill-caution">{dashboard.forecast.risks.length} active</span>
          </div>
          {dashboard.forecast.risks.map((risk) => (
            <div className="risk-row" key={risk.id ?? risk.hospital_id + String(risk.reason)}>
              <div className="row-top">
                <strong>{hospitalName(risk.hospital_id, dashboard.hospitals)}</strong>
                <span className={`pill pill-${severityTone(risk.severity)}`}>
                  <IconAlert size={12} /> {risk.severity}
                </span>
              </div>
              <div className="risk-when">
                <IconClock size={12} />
                <span className="tabular">{clock(risk.start_at)}</span>
                <span>·</span>
                <span>{clockDate(risk.start_at)}</span>
              </div>
              <div className="risk-copy">{risk.reason ?? risk.explanation}</div>
            </div>
          ))}
        </Reveal>
      </div>

      <div className="desk-grid">
        <Reveal className="panel">
          <div className="panel-head">
            <div>
              <h2>Physicians</h2>
              <p>Shift state · experience · Synapse readiness</p>
            </div>
          </div>
          {dashboard.physicians.slice(0, 6).map((p) => {
            const econ = experienceOf(p.id);
            return (
              <div className="rail-row" key={p.id}>
                <div className="row-top">
                  <strong>{p.name}</strong>
                  <span className={`pill ${p.availability.status === "available" ? "pill-signal" : "pill-muted"}`}>
                    {p.availability.status.replace("_", " ")}
                  </span>
                </div>
                <div className="rail-meta">
                  {econ ? (
                    <span className="rail-exp tabular">
                      {econ.years} yrs · {seniority(econ.years)}
                    </span>
                  ) : null}
                  {p.availability.on_shift ? "On shift" : "Off shift"}
                  {p.availability.conflicts?.length ? " · camera/Synapse conflict" : ""}
                  {p.availability.stale ? " · unverified signal" : ""}
                </div>
              </div>
            );
          })}
        </Reveal>

        <Reveal className="panel" delay={0.06}>
          <div className="panel-head">
            <div>
              <h2>Coverage map</h2>
              <p>Hospital nodes and physician capacity</p>
            </div>
          </div>
          <NetworkVisual filled={filled} schematic />
        </Reveal>
      </div>

      <AnimatePresence>
        {panel !== "none" ? (
          <>
            <motion.button
              type="button"
              aria-label="Close panel"
              className="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPanel("none")}
            />
            <motion.aside
              className="drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="decide-title"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <h2 id="decide-title" className="drawer-title">
                    {panel === "act" ? "Act on the offer" : "Decide"}
                  </h2>
                  <p className="drawer-sub">Eligibility first. Human approval before any offer.</p>
                </div>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPanel("none")}>
                  Close
                </button>
              </div>
              <div style={{ marginTop: 20 }}>
                <OfferLoop />
              </div>
              <div style={{ marginTop: 28 }}>
                <h3 className="drawer-section-title">Offer order</h3>
                <OfferEconomics compact />
              </div>
              <div style={{ marginTop: 28 }}>
                <h3 className="drawer-section-title">Off-shift eligibility</h3>
                <EligibilityMatrix
                  recommendation={recommendation}
                  physicians={dashboard.physicians}
                  order={demo.ranked.map((c) => c.candidate.physician_id)}
                />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
