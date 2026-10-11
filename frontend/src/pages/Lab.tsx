import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../demo/store";
import { clock } from "../lib/format";

const PRESETS = [
  "Physician unavailable: Lakeside backup offline",
  "Demand spike: Bayview 3 consults in 12 minutes",
  "Duplicate event replayed (idempotent)",
  "Late-arriving camera signal for Dr. Park",
];

export default function Lab() {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const [text, setText] = useState(PRESETS[0]);
  const [flash, setFlash] = useState(0);

  return (
    <div className="lab-stack">
      <section className="panel lab-hero-panel">
        <div className="panel-head">
          <div>
            <h2>Inject an event</h2>
            <p>Judge-ready tele-neurology scenarios without restarting the app</p>
          </div>
          <span className="neuro-badge">Scenario lab</span>
        </div>
        <label className="lab-label">
          Event description
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="lab-textarea"
          />
        </label>
        <div className="lab-presets">
          {PRESETS.map((p) => (
            <motion.button
              key={p}
              type="button"
              className={`preset-chip${text === p ? " on" : ""}`}
              onClick={() => {
                setText(p);
                setFlash((n) => n + 1);
              }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              animate={
                text === p && !reduce
                  ? { boxShadow: "0 0 0 3px rgba(18,163,122,0.2)" }
                  : { boxShadow: "0 0 0 0 rgba(18,163,122,0)" }
              }
              transition={{ duration: 0.25 }}
            >
              {p.length > 32 ? `${p.slice(0, 32)}…` : p}
            </motion.button>
          ))}
        </div>
        <div className="lab-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              demo.injectEvent(text);
              setFlash((n) => n + 1);
            }}
          >
            Inject event
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => demo.resetFlow()}
          >
            Reset demo snapshot
          </button>
        </div>
      </section>

      <div className="desk-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Event log</h2>
              <p>Audit trail for every inject and decision</p>
            </div>
          </div>
          <div className="event-log">
            <AnimatePresence initial={false}>
              {demo.events.map((e, idx) => (
                <motion.div
                  className="event-entry"
                  key={e.id}
                  initial={reduce || idx > 0 ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28 }}
                  layout={!reduce}
                >
                  <span className="event-time tabular">{clock(e.at)}</span>
                  <p className="event-text">{e.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {!demo.events.length ? (
              <p className="event-text" style={{ color: "var(--text-faint)" }}>
                Inject a scenario to start the audit trail.
              </p>
            ) : null}
          </div>
          <span className="sr-only" aria-live="polite">
            {flash ? `Log updated ${flash}` : ""}
          </span>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Safety constraints</h2>
              <p>Visible by design for clinical ops</p>
            </div>
          </div>
          <ul className="safety-list">
            <li>No patient information in notifications</li>
            <li>Clinical lead approval before every offer</li>
            <li>One open offer per physician · at most 3 per week</li>
            <li>Offers expire after 10 minutes</li>
            <li>Eligibility failures never hidden behind a score</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
