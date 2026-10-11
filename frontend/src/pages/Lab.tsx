import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconAlert, IconBolt, IconCheck, IconClock, IconLink, IconShield } from "../components/Icons";
import { Card, EASE, Segmented } from "../components/ui";
import { InterventionQueue } from "../components/desk/InterventionQueue";
import { Reveal } from "../components/Reveal";
import { useDemo, type InjectInput } from "../demo/store";
import { clock } from "../lib/format";

type Priority = InjectInput["priority"];

const PRESETS: {
  kind: string;
  icon: typeof IconAlert;
  text: string;
  hospitalId: string;
  priority: Priority;
  minutes: number;
}[] = [
  {
    kind: "Outage",
    icon: IconAlert,
    text: "Physician unavailable: Lakeside backup offline",
    hospitalId: "hosp-lake",
    priority: "high",
    minutes: 30,
  },
  {
    kind: "Demand spike",
    icon: IconBolt,
    text: "Demand spike: Bayview 3 consults in 12 minutes",
    hospitalId: "hosp-bay",
    priority: "critical",
    minutes: 30,
  },
  {
    kind: "Replay",
    icon: IconLink,
    text: "Duplicate event replayed (idempotent)",
    hospitalId: "hosp-cedar",
    priority: "info",
    minutes: 15,
  },
  {
    kind: "Late signal",
    icon: IconClock,
    text: "Late-arriving camera signal for Dr. Park",
    hospitalId: "hosp-lake",
    priority: "medium",
    minutes: 15,
  },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "info", label: "Log only" },
];

const MINUTES = [15, 30, 45, 60];

const SAFETY = [
  "No patient information in notifications",
  "Clinical lead approval before every offer",
  "One open offer per physician · at most 3 per week",
  "Offers expire after 10 minutes",
  "Eligibility failures never hidden behind a score",
  "Cost only reorders physicians who are already eligible",
];

const MAX = 160;

export default function Lab() {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [text, setText] = useState(PRESETS[0].text);
  const [hospitalId, setHospitalId] = useState(PRESETS[0].hospitalId);
  const [priority, setPriority] = useState<Priority>(PRESETS[0].priority);
  const [minutes, setMinutes] = useState(PRESETS[0].minutes);
  const [lastRisk, setLastRisk] = useState<{ id: string | null; text: string } | null>(null);
  const [touched, setTouched] = useState(false);
  const [justInjected, setJustInjected] = useState(false);
  const trimmed = text.trim();
  const invalid = touched && !trimmed;

  useEffect(() => {
    if (!justInjected) return;
    const t = window.setTimeout(() => setJustInjected(false), 1600);
    return () => window.clearTimeout(t);
  }, [justInjected]);

  const inject = () => {
    setTouched(true);
    if (!trimmed) return;
    const id = demo.injectEvent({ text: trimmed, hospitalId, priority, unmetMinutes: minutes });
    setLastRisk({ id, text: trimmed });
    setJustInjected(true);
  };

  return (
    <div className="rx-page">
      <Card
        title="Inject an event"
        icon={<IconBolt size={18} />}
        index={0}
      >
        <div className="rx-presets" role="group" aria-label="Scenario presets">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            const on = text === p.text;
            return (
              <button
                key={p.text}
                type="button"
                className="rx-preset"
                aria-pressed={on}
                onClick={() => {
                  setText(p.text);
                  setHospitalId(p.hospitalId);
                  setPriority(p.priority);
                  setMinutes(p.minutes);
                  setTouched(false);
                }}
              >
                <span className="rx-preset-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <span className="rx-preset-kind">{p.kind}</span>
                  <span className="rx-preset-text">{p.text}</span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="rx-field">
          Event description
          <textarea
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={invalid}
            aria-describedby="lab-hint"
            rows={3}
          />
          <span id="lab-hint" className={`rx-field-hint${invalid ? " error" : ""}`}>
            {invalid ? "Describe the event before injecting it." : `${text.length}/${MAX} · plain language, no patient details`}
          </span>
        </label>

        <div className="rx-inject-fields">
          <label className="rx-field rx-field-inline">
            Hospital
            <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              {demo.dashboard.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <div className="rx-field rx-field-inline">
            <span id="lab-priority">Priority</span>
            <Segmented<Priority>
              idBase="lab-priority"
              label="Priority"
              options={PRIORITIES}
              value={priority}
              onChange={setPriority}
            />
          </div>
          <label className="rx-field rx-field-inline">
            Uncovered minutes
            <select
              value={minutes}
              disabled={priority === "info"}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rx-lab-actions">
          <button
            type="button"
            className={`rx-btn rx-btn-primary${justInjected ? " is-success" : ""}`}
            onClick={inject}
            aria-live="polite"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={justInjected ? "done" : "idle"}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: EASE }}
              >
                {justInjected ? <IconCheck size={16} strokeWidth={2.2} /> : <IconBolt size={16} />}
                {justInjected ? "Injected" : "Inject event"}
              </motion.span>
            </AnimatePresence>
          </button>
          <button type="button" className="rx-btn rx-btn-secondary" onClick={() => demo.resetFlow()}>
            Reset demo snapshot
          </button>
        </div>

        <AnimatePresence initial={false}>
          {lastRisk ? (
            <motion.div
              key={lastRisk.id ?? lastRisk.text}
              className={`rx-inject-result${lastRisk.id ? "" : " is-info"}`}
              role="status"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              <div>
                <strong>{lastRisk.id ? "Risk queued for intervention" : "Logged without a new risk"}</strong>
                <span>{lastRisk.text}</span>
              </div>
              {lastRisk.id && demo.queue.some((q) => q.risk.id === lastRisk.id) ? (
                <button
                  type="button"
                  className="rx-btn rx-btn-primary rx-btn-sm"
                  onClick={() => {
                    demo.openIntervention(lastRisk.id as string);
                    navigate("/app");
                  }}
                >
                  Find backup
                  <span className="rx-btn-arrow" aria-hidden>
                    →
                  </span>
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>

      <InterventionQueue goToDesk index={1} />

      <div className="rx-grid-2">
        <Card
          title="Event log"
          count={`×${demo.events.length}`}
          icon={<IconClock size={18} />}
          index={1}
        >
          {demo.events.length ? (
            <ol className="rx-timeline">
              <AnimatePresence initial={false}>
                {demo.events.map((e, i) => (
                  <motion.li
                    key={e.id}
                    className={i === 0 ? "is-latest" : ""}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                  >
                    <time dateTime={e.at} className="num">
                      {clock(e.at)}
                    </time>
                    {e.text}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          ) : (
            <div className="rx-empty">
              <strong>No events yet</strong>
              Inject a scenario to start the audit trail.
            </div>
          )}
        </Card>

        <Card
          title="Safety constraints"
          icon={<IconShield size={18} />}
          index={2}
        >
          <ul className="rx-safety">
            {SAFETY.map((s, i) => (
              <Reveal as="li" key={s} delay={i * 0.06}>
                <span aria-hidden>
                  <IconCheck size={13} strokeWidth={2.4} />
                </span>
                <span>{s}</span>
              </Reveal>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
