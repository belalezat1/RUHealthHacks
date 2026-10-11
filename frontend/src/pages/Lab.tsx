import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Reveal } from "../components/Reveal";
import { IconAlert, IconBolt, IconClock, IconLink } from "../components/Icons";
import { useDemo } from "../demo/store";
import { clock } from "../lib/format";

const PRESETS = [
  {
    kind: "Outage",
    icon: IconAlert,
    text: "Physician unavailable: Lakeside backup offline",
  },
  {
    kind: "Demand spike",
    icon: IconBolt,
    text: "Demand spike: Bayview 3 consults in 12 minutes",
  },
  {
    kind: "Replay",
    icon: IconLink,
    text: "Duplicate event replayed (idempotent)",
  },
  {
    kind: "Late signal",
    icon: IconClock,
    text: "Late-arriving camera signal for Dr. Park",
  },
];

const SAFETY = [
  "No patient information in notifications",
  "Clinical lead approval before every offer",
  "One open offer per physician · at most 3 per week",
  "Offers expire after 10 minutes",
  "Eligibility failures never hidden behind a score",
  "Cost only reorders physicians who are already eligible",
];

export default function Lab() {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const [text, setText] = useState(PRESETS[0].text);
  const [flash, setFlash] = useState(0);
  const [justInjected, setJustInjected] = useState(false);

  useEffect(() => {
    if (!justInjected) return;
    const t = window.setTimeout(() => setJustInjected(false), 1600);
    return () => window.clearTimeout(t);
  }, [justInjected]);

  return (
    <div className="lab-stack">
      <Reveal className="panel lab-hero-panel">
        <div className="panel-head">
          <div>
            <h2>Inject an event</h2>
            <p>Push an edge case into the live snapshot without restarting the app</p>
          </div>
          <span className="pill pill-muted tabular">{demo.events.length} logged</span>
        </div>

        <div className="preset-grid" role="group" aria-label="Scenario presets">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            const on = text === p.text;
            return (
              <motion.button
                key={p.text}
                type="button"
                className={`preset-chip${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => setText(p.text)}
                whileTap={reduce ? undefined : { scale: 0.97 }}
              >
                <span className="preset-icon">
                  <Icon size={16} />
                </span>
                <span className="preset-copy">
                  <span className="preset-kind">{p.kind}</span>
                  <span className="preset-text">{p.text}</span>
                </span>
              </motion.button>
            );
          })}
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

        <div className="lab-actions">
          <button
            type="button"
            className={`btn btn-primary${justInjected ? " btn-done" : ""}`}
            disabled={!text.trim()}
            onClick={() => {
              demo.injectEvent(text.trim());
              setFlash((n) => n + 1);
              setJustInjected(true);
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={justInjected ? "done" : "idle"}
                className="btn-swap"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {justInjected ? (
                  <>Injected ✓</>
                ) : (
                  <>
                    <IconBolt size={16} /> Inject event
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => demo.resetFlow()}>
            Reset demo snapshot
          </button>
          <span className="lab-hint">Lands in Ranked risks on the Coverage desk.</span>
        </div>
      </Reveal>

      <div className="desk-grid">
        <Reveal className="panel">
          <div className="panel-head">
            <div>
              <h2>Event log</h2>
              <p>Audit trail for every inject and decision</p>
            </div>
          </div>
          <ol className="event-log">
            <AnimatePresence initial={false}>
              {demo.events.map((e, idx) => (
                <motion.li
                  className={`event-entry${idx === 0 ? " latest" : ""}`}
                  key={e.id}
                  initial={reduce ? false : { opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  layout={!reduce}
                >
                  <span className="event-dot" aria-hidden />
                  <span className="event-time tabular">{clock(e.at)}</span>
                  <p className="event-text">{e.text}</p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          {!demo.events.length ? (
            <p className="event-text" style={{ color: "var(--text-faint)" }}>
              Inject a scenario to start the audit trail.
            </p>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {flash ? `Event injected. Log has ${demo.events.length} entries.` : ""}
          </span>
        </Reveal>

        <Reveal className="panel" delay={0.06}>
          <div className="panel-head">
            <div>
              <h2>Safety constraints</h2>
              <p>Enforced on every offer, visible by design</p>
            </div>
          </div>
          <ul className="safety-list">
            {SAFETY.map((s) => (
              <li key={s}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12.5l4.2 4.2L19 7"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {s}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}
