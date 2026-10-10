// Dashboard primitives in the style of Sevaro's product UI: gauge rings, stat tiles with
// soft icon circles, and physician cards with presence dot and pill tags.
import type { ReactNode } from "react";
import type { Physician, Report } from "../types";

// ---------------------------------------------------------------- icons (inline, 18px, stroke)
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  video: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>,
  phone: <svg viewBox="0 0 24 24" {...P}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" /></svg>,
  doc: <svg viewBox="0 0 24 24" {...P}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
  alert: <svg viewBox="0 0 24 24" {...P}><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17.5v.5" /></svg>,
  queue: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  hospital: <svg viewBox="0 0 24 24" {...P}><path d="M4 21V7l8-4 8 4v14" /><path d="M12 9v6M9 12h6M4 21h16" /></svg>,
};

export function StatTile({ value, label, icon, tone = "indigo", sub }: {
  value: ReactNode; label: string; icon: ReactNode; tone?: "indigo" | "teal" | "rose" | "amber"; sub?: ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <div className="stat-value num">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <span className={`icon-bubble ${tone}`} aria-hidden>{icon}</span>
    </div>
  );
}

/** 270° gauge ring with an end-cap dot, like Sevaro's TSP rings. */
export function Ring({ value, max, label, sub, color }: {
  value: number; max: number; label: string; sub: string; color: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const R = 52, C = 2 * Math.PI * R, ARC = 0.75;
  const start = 135; // degrees, gap at the bottom
  const end = ((start + 270 * pct) * Math.PI) / 180;
  const cx = 70 + R * Math.cos(end), cy = 70 + R * Math.sin(end);
  return (
    <figure className="ring" aria-label={`${label}: ${Math.round(pct * 100)}% (${value} of ${max})`}>
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={R} fill="none" stroke={color} strokeOpacity="0.14" strokeWidth="12"
          strokeDasharray={`${C * ARC} ${C}`} strokeLinecap="round" transform={`rotate(${start} 70 70)`} />
        <circle cx="70" cy="70" r={R - 15} fill="none" stroke="var(--grid)" strokeWidth="1.5" strokeDasharray="1 5" />
        {pct > 0 && (
          <circle cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="12"
            strokeDasharray={`${C * ARC * pct} ${C}`} strokeLinecap="round" transform={`rotate(${start} 70 70)`} />
        )}
        {pct > 0 && <circle cx={cx} cy={cy} r="4" fill="#fff" />}
        <text x="70" y="70" textAnchor="middle" className="ring-value">{Math.round(pct * 100)}%</text>
        <text x="70" y="90" textAnchor="middle" className="ring-sub">{value}/{max}</text>
      </svg>
      <figcaption>
        <div className="ring-label">{label}</div>
        <div className="ring-caption">{sub}</div>
      </figcaption>
    </figure>
  );
}

function initials(name: string) {
  return name.replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
}

export function PhysicianCard({ p }: { p: Physician }) {
  const off = p.derived_state === "Off Shift";
  const presence = off ? "off" : !p.presence_verified ? "unverified" : p.routable ? "free" : "busy";
  const tags: { text: string; tone: string }[] = [];
  if (p.derived_state === "Temporarily Unavailable") tags.push({ text: "Unavailable", tone: "rose" });
  else if (p.busy) tags.push({ text: "Busy", tone: "amber" });
  else if (p.routable) tags.push({ text: "Routable", tone: "teal" });
  if (!p.presence_verified && !off) tags.push({ text: "Unverified", tone: "rose" });
  if (p.ringing_consult) tags.push({ text: "Ringing", tone: "amber" });
  if (p.planned_capacity) tags.push({ text: "Split shift", tone: "indigo" });
  tags.push({ text: `${p.credentials.length} sites`, tone: "lavender" });
  return (
    <article className="phys-card">
      <div className="avatar" aria-hidden>
        {initials(p.name)}
        <span className={`presence ${presence}`} />
      </div>
      <div className="phys-main">
        <div className="phys-name">{p.name}</div>
        <div className="phys-state">{p.derived_state}{p.minutes_to_shift_end !== null && !off ? ` · ${p.minutes_to_shift_end} min left` : ""}</div>
        <div className="tags">{tags.map((t) => <span key={t.text} className={`tag ${t.tone}`}>{t.text}</span>)}</div>
      </div>
      <div className="phys-nums">
        <div><b className="num">{p.consults_this_shift}</b><span>consults</span></div>
        <div><b className="num">{p.open_consults}</b><span>open</span></div>
      </div>
    </article>
  );
}

/** Network pulse: the three rings + live tiles at the top of the desk. */
export function NetworkPulse({ r }: { r: Report }) {
  const stroke = r.consults.filter((c) => c.consult_type === "Stroke");
  const flagged = new Set(
    r.risks.filter((x) => x.consult_id && ["stage_breach", "documentation_delay", "assigned_to_unavailable"].includes(x.kind))
      .map((x) => x.consult_id),
  );
  const strokeOk = stroke.filter((c) => !flagged.has(c.consult_id)).length;
  const onShift = r.physicians.filter((p) => p.derived_state !== "Off Shift");
  const routable = onShift.filter((p) => p.routable).length;
  const st = r.staffing;
  const offer = [...r.offers].reverse().find((o) => st.target && o.hospitals.includes(st.target.hospital_id)
    && ["proposed", "approved", "sent", "accepted"].includes(o.status));
  const accepted = offer?.status === "accepted";
  const gapBefore = offer ? Number(offer.rationale.baseline_deficit_minutes) : st.baseline_deficit_minutes || 0;
  const gapRemoved = offer ? Number(offer.rationale.deficit_minutes_removed) : st.deficit_minutes_removed ?? 0;
  const gapHospitals = r.coverage.hospitals.filter((h) => h.deficit_minutes > 0).length;
  const video = r.physicians.filter((p) => p.derived_state === "Video Consult In Progress").length;
  const calls = r.physicians.filter((p) => p.derived_state.endsWith("Hospital Call")).length;
  const notes = r.consults.filter((c) => c.current_stage === "Note Pending" || c.current_stage === "Documentation").length;
  const waiting = r.consults.filter((c) => c.current_stage === "Received" || c.current_stage === "Triaged").length;
  const critical = r.risks.filter((x) => x.severity === "critical").length;

  return (
    <section className="card pulse" aria-label="Network pulse">
      <div className="rings">
        <Ring value={strokeOk} max={stroke.length} color="#f0446b" label="Stroke on time"
          sub={`${stroke.length - strokeOk} over a time standard`} />
        <Ring value={routable} max={onShift.length} color="#5d5de5" label="Physicians free"
          sub="can take the next call" />
        <Ring value={gapRemoved} max={gapBefore || 1} color="#24c3b8"
          label={st.target ? "Gap closed by offer" : "No projected gap"}
          sub={st.target ? `${st.target.hospital_name}${accepted ? " · accepted" : ""}` : "coverage is met"} />
      </div>
      <div className="tiles">
        <StatTile value={video} label="Video in progress" icon={Icon.video} tone="rose" />
        <StatTile value={calls} label="On hospital calls" icon={Icon.phone} tone="teal" />
        <StatTile value={notes} label="Notes open" icon={Icon.doc} tone="indigo" />
        <StatTile value={waiting} label="Waiting for physician" icon={Icon.queue} tone="amber" />
        <StatTile value={critical} label="Critical items" icon={Icon.alert} tone="rose" />
        <StatTile value={gapHospitals} label="Hospitals short (90 min)" icon={Icon.hospital} tone="indigo" />
      </div>
    </section>
  );
}
