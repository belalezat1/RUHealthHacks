import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ConsultBoard } from "../components/ConsultBoard";
import { CoverageHorizon } from "../components/CoverageHorizon";
import { EligibilityMatrix } from "../components/EligibilityMatrix";
import { NetworkVisual } from "../components/NetworkVisual";
import { OfferLoop } from "../components/OfferLoop";
import { IconAlert, IconClock } from "../components/Icons";
import { useDemo } from "../demo/store";
import {
  clock,
  clockDate,
  hospitalName,
  minutesUntil,
  severityTone,
} from "../lib/format";

export default function Desk() {
  const demo = useDemo();
  const { dashboard, recommendation, panel, setPanel, openDecide, offerStep } =
    demo;
  const topRisk = dashboard.forecast.risks[0];
  const filled = offerStep === "filled";

  useEffect(() => {
    if (sessionStorage.getItem("sevaro-open-decide") === "1") {
      sessionStorage.removeItem("sevaro-open-decide");
      openDecide();
    }
  }, [openDecide]);

  const waiting = dashboard.consultations.filter((c) => c.status === "waiting").length;
  const onCall = dashboard.physicians.filter((p) => p.availability.on_shift).length;
  const urgent = dashboard.consultations.filter(
    (c) => c.priority === "urgent" || c.priority === "stroke",
  ).length;
  const synapseLive = dashboard.consultations.filter(
    (c) => c.status === "in_progress" || c.status === "waiting",
  ).length;

  const gapMins = topRisk?.start_at
    ? Math.max(1, Math.min(90, minutesUntil(String(topRisk.start_at), dashboard.as_of)))
    : null;

  return (
    <div className="desk">
      {filled ? (
        <motion.div
          className="success-banner"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
        >
          <strong>Coverage restored at Riverfront</strong>
          <p style={{ margin: "8px 0 0", color: "var(--text-soft)" }}>
            Gap filled. Offers stopped. Projected capacity meets the minimum for
            the next 90 minutes.
          </p>
        </motion.div>
      ) : (
        <section className="insight insight-solo" aria-labelledby="insight-title">
          <div className="insight-copy">
            <p className="insight-kicker">NEEDS ATTENTION</p>
            <h1 id="insight-title">
              {topRisk && gapMins != null
                ? `Coverage gap in ${gapMins} min at ${hospitalName(topRisk.hospital_id, dashboard.hospitals)}`
                : "Network stable for the next 90 minutes"}
            </h1>
            <p>{topRisk?.reason ?? "No ranked coverage risks in the forecast horizon."}</p>
            <p className="insight-next">
              Next: review eligibility, then approve a split-shift offer.
            </p>
            <span className="neuro-badge">Tele-neurology · stroke-priority</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openDecide()}
          >
            Review intervention
          </button>
        </section>
      )}

      <div className="stat-strip" aria-label="Live stats">
        <div className="stat-tile">
          <div className="n tabular">{onCall}</div>
          <div className="l">Neurologists on call</div>
        </div>
        <div className="stat-tile">
          <div className="n tabular">{waiting}</div>
          <div className="l">Consults waiting</div>
        </div>
        <div className="stat-tile stat-tile-accent">
          <div className="n tabular">{urgent}</div>
          <div className="l">Stroke-priority</div>
        </div>
        <div className="stat-tile">
          <div className="n tabular">{synapseLive}</div>
          <div className="l">Synapse pathways</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Next 90 minutes</h2>
            <p>Credentialed neurology capacity vs consult demand · 15-minute slots</p>
          </div>
        </div>
        <CoverageHorizon forecast={dashboard.forecast} />
      </section>

      <div className="desk-grid">
        <section className="panel">
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
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Ranked risks</h2>
              <p>Plain-language coverage reasons</p>
            </div>
            <span className="pill pill-caution">
              {dashboard.forecast.risks.length} active
            </span>
          </div>
          {dashboard.forecast.risks.map((risk) => (
            <div
              className="risk-row"
              key={risk.id ?? risk.hospital_id + String(risk.reason)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>
                  {hospitalName(risk.hospital_id, dashboard.hospitals)}
                </strong>
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
              <div className="risk-copy">
                {risk.reason ?? risk.explanation}
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className="desk-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Physicians</h2>
              <p>Neurology specialty · shift state · Synapse readiness</p>
            </div>
          </div>
          {dashboard.physicians.slice(0, 6).map((p) => (
            <div className="rail-row" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{p.name}</strong>
                <span className="pill pill-muted">{p.availability.status}</span>
              </div>
              <div className="rail-specialty">
                {(p.specialties ?? ["neurology"]).join(", ")}
              </div>
              <div className="rail-meta">
                {p.availability.on_shift ? "On shift" : "Off shift"}
                {p.availability.conflicts?.length
                  ? " · camera/Synapse conflict"
                  : ""}
                {p.availability.stale ? " · unverified signal" : ""}
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Coverage map</h2>
              <p>Hospital nodes and physician capacity</p>
            </div>
          </div>
          <NetworkVisual filled={filled} schematic />
        </section>
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
                  <p className="drawer-sub">
                    Eligibility first. Human approval before any offer.
                  </p>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setPanel("none")}
                >
                  Close
                </button>
              </div>
              <div style={{ marginTop: 20 }}>
                <OfferLoop />
              </div>
              <div style={{ marginTop: 28 }}>
                <h3 className="drawer-section-title">Off-shift eligibility</h3>
                <EligibilityMatrix
                  recommendation={recommendation}
                  physicians={dashboard.physicians}
                />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
