import { useState } from "react";
import { useDemo } from "../demo/store";
import { clock } from "../lib/format";

const PRESETS = [
  "Physician unavailable — Lakeside backup offline",
  "Demand spike — Bayview 3 consults in 12 minutes",
  "Duplicate event replayed (idempotent)",
  "Late-arriving camera signal for Dr. Park",
];

export default function Lab() {
  const demo = useDemo();
  const [text, setText] = useState(PRESETS[0]);

  return (
    <>
      <aside className="rd-mission" aria-label="Lab controls">
        <div className="card-soft">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Inject event</div>
          <p style={{ margin: "0 0 12px", color: "var(--ink-muted)", fontSize: 13 }}>
            Same narrative format judges use — applied without restart.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid var(--line-strong)",
              padding: 12,
              resize: "vertical",
            }}
          />
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => demo.injectEvent(text)}
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
        </div>
        <div className="card-soft">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Presets</div>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginBottom: 8, justifyContent: "flex-start" }}
              onClick={() => setText(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </aside>

      <section className="rd-stage">
        <div className="card">
          <strong>Event log</strong>
          <p style={{ margin: "6px 0 12px", color: "var(--ink-muted)", fontSize: 13 }}>
            Who was considered, approved, and the outcome — audit-ready
          </p>
          {demo.events.map((e) => (
            <div className="rail-row" key={e.id}>
              <div className="tabular" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                {clock(e.at)}
              </div>
              <div>{e.text}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <strong>Safety constraints</strong>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--ink-muted)" }}>
            <li>No patient information in notifications</li>
            <li>Clinical lead approval before every offer</li>
            <li>One open offer per physician · at most 3 per week</li>
            <li>Offers expire after 10 minutes</li>
            <li>Eligibility failures never hidden behind a score</li>
          </ul>
        </div>
      </section>
    </>
  );
}