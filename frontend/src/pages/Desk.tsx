import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CoverageHorizon } from "../components/CoverageHorizon";
import { EligibilityMatrix } from "../components/EligibilityMatrix";
import { NetworkVisual } from "../components/NetworkVisual";
import { OfferLoop } from "../components/OfferLoop";
import { IconPin } from "../components/Icons";
import { useDemo } from "../demo/store";
import { hospitalName, severityTone } from "../lib/format";

export default function Desk() {
  const demo = useDemo();
  const { dashboard, recommendation, panel, setPanel, openDecide, offerStep } =
    demo;
  const topRisk = dashboard.forecast.risks[0];
  const filled = offerStep === "filled";
  const [focusHospital, setFocusHospital] = useState(
    topRisk?.hospital_id ?? dashboard.hospitals[0]?.id,
  );

  useEffect(() => {
    if (sessionStorage.getItem("sevaro-open-decide") === "1") {
      sessionStorage.removeItem("sevaro-open-decide");
      openDecide();
    }
  }, [openDecide]);

  const waiting = dashboard.consultations.filter((c) => c.status === "waiting").length;
  const onCall = dashboard.physicians.filter((p) => p.availability.on_shift).length;
  const strokeish = dashboard.consultations.filter(
    (c) => c.priority === "urgent",
  ).length;

  return (
    <>
      <aside className="rd-mission" aria-label="Mission panel">
        <div className="location-chip">
          <span style={{ color: "var(--signal)" }}>
            <IconPin />
          </span>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-muted)", fontWeight: 500 }}>
              Network focus
            </div>
            {hospitalName(String(focusHospital), dashboard.hospitals)}
          </div>
          <span className="dot-live" aria-label="Live" />
        </div>

        <div className="card-soft">
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Intervention in work</div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 10 }}>
            {recommendation.id} · {recommendation.status}
          </div>
          <button
            type="button"
            className="asset-card selected"
            onClick={openDecide}
          >
            <div className="asset-avatar">MV</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Dr. Morgan Vale</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Split-shift · gap hospitals only
              </div>
            </div>
            <span className="pill pill-signal">Select</span>
          </button>
          <div style={{ height: 8 }} />
          <button
            type="button"
            className="asset-card"
            onClick={openDecide}
          >
            <div className="asset-avatar">PC</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Dr. Priya Chen</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Alternative · longer online time
              </div>
            </div>
          </button>
        </div>

        <div className="card-soft">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Physicians</div>
          {dashboard.physicians.slice(0, 5).map((p) => (
            <div className="rail-row" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{p.name}</strong>
                <span className="pill pill-muted">{p.availability.status}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                {p.availability.on_shift ? "On shift" : "Off shift"}
                {p.availability.conflicts?.length ? " · signal conflict" : ""}
                {p.availability.stale ? " · unverified" : ""}
              </div>
            </div>
          ))}
        </div>

        <button type="button" className="btn btn-primary" onClick={openDecide}>
          Review intervention
        </button>
      </aside>

      <section className="rd-stage">
        {filled ? (
          <motion.div
            className="success-banner"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
          >
            <strong>Coverage restored at Riverfront</strong>
            <p style={{ margin: "8px 0 0", color: "var(--ink-muted)" }}>
              Gap filled — offers stopped. Projected capacity meets the minimum for
              the next 90 minutes.
            </p>
          </motion.div>
        ) : (
          <section className="insight-banner" aria-labelledby="insight-title">
            <div>
              <p className="insight-kicker">NEEDS ATTENTION</p>
              <h1 id="insight-title">
                {topRisk
                  ? `Coverage gap in ${Math.max(
                      1,
                      Math.round(
                        (new Date(String(topRisk.start_at)).getTime() -
                          new Date(dashboard.as_of).getTime()) /
                          60000,
                      ),
                    )} min at ${hospitalName(topRisk.hospital_id, dashboard.hospitals)}`
                  : "Network stable for the next 90 minutes"}
              </h1>
              <p style={{ margin: 0, color: "var(--ink-muted)", maxWidth: "54ch" }}>
                {topRisk?.reason ??
                  "No ranked coverage risks in the forecast horizon."}
              </p>
            </div>
            <button type="button" className="btn btn-signal" onClick={openDecide}>
              Review intervention
            </button>
          </section>
        )}

        <div className="stat-strip" aria-label="Today and live stats">
          <div className="stat-tile">
            <div className="n tabular">{onCall}</div>
            <div className="l">Providers on call</div>
          </div>
          <div className="stat-tile">
            <div className="n tabular">{waiting}</div>
            <div className="l">Consults waiting</div>
          </div>
          <div className="stat-tile">
            <div className="n tabular">{strokeish}</div>
            <div className="l">Urgent / stroke-priority</div>
          </div>
        </div>

        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 12,
              gap: 12,
            }}
          >
            <div>
              <strong>Time-to-coverage proxies</strong>
              <div style={{ color: "var(--ink-muted)", fontSize: 13 }}>
                Honest rings from current horizon pressure — not marketing TSP theater
              </div>
            </div>
          </div>
          <div className="rings">
            <div
              className="ring"
              style={{ ["--p" as string]: "50%", ["--ring-color" as string]: "#e11d48" }}
            >
              <span className="tabular">50%</span>
            </div>
            <div
              className="ring"
              style={{ ["--p" as string]: "70%", ["--ring-color" as string]: "#6366f1" }}
            >
              <span className="tabular">70%</span>
            </div>
            <div
              className="ring"
              style={{ ["--p" as string]: "82%", ["--ring-color" as string]: "#2f9e8f" }}
            >
              <span className="tabular">82%</span>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 8,
              marginTop: 8,
              fontSize: 11,
              color: "var(--ink-muted)",
              textAlign: "center",
            }}
          >
            <div>&lt; 20 min pressure</div>
            <div>&lt; 40 min pressure</div>
            <div>&lt; 60 min covered</div>
          </div>
        </div>

        <NetworkVisual filled={filled} schematic />

        <div className="card">
          <div style={{ marginBottom: 12 }}>
            <strong>Next 90 minutes</strong>
            <div style={{ color: "var(--ink-muted)", fontSize: 13 }}>
              Required vs available credentialed capacity · 15-minute slots
            </div>
          </div>
          <CoverageHorizon forecast={dashboard.forecast} />
        </div>

        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <strong>Ranked risks</strong>
            <span className="pill pill-caution">
              {dashboard.forecast.risks.length} active
            </span>
          </div>
          {dashboard.forecast.risks.map((risk) => (
            <button
              type="button"
              className="risk-row"
              key={risk.id ?? risk.hospital_id + String(risk.reason)}
              onClick={() => setFocusHospital(risk.hospital_id)}
              style={{
                width: "100%",
                background: "transparent",
                border: 0,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{hospitalName(risk.hospital_id, dashboard.hospitals)}</strong>
                <span className={`pill pill-${severityTone(risk.severity)}`}>
                  {risk.severity}
                </span>
              </div>
              <div style={{ color: "var(--ink-muted)", fontSize: 13 }}>
                {risk.reason ?? risk.explanation}
              </div>
            </button>
          ))}
        </div>
      </section>

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
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <h2 id="decide-title" style={{ margin: 0, letterSpacing: "-0.02em" }}>
                    {panel === "act" ? "Act on the offer" : "Decide"}
                  </h2>
                  <p style={{ margin: "6px 0 0", color: "var(--ink-muted)" }}>
                    Eligibility first, ranking second, explanation third.
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
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
                <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
                  Off-shift eligibility
                </h3>
                <EligibilityMatrix
                  recommendation={recommendation}
                  physicians={dashboard.physicians}
                />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}