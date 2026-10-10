import { useRef, useState } from "react";
import { hhmm } from "../format";
import type { HospitalProjection } from "../types";

const SERIES = [
  { key: "required", label: "Required", color: "var(--series-2)", dash: "" },
  { key: "available", label: "Available (persistent activity)", color: "var(--series-1)", dash: "" },
  { key: "roster_ceiling", label: "Roster ceiling", color: "var(--series-3)", dash: "4 3" },
] as const;

/** Step chart of required vs. available credentialed physicians for one hospital. */
export function ForecastChart({ hospital }: { hospital: HospitalProjection }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = 640, H = 220, L = 34, R = 12, T = 10, B = 26;
  const s = hospital.samples;
  const maxY = Math.max(3, ...s.flatMap((x) => [x.required, x.available, x.roster_ceiling]));
  const x = (i: number) => L + (i / (s.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const step = (key: (typeof SERIES)[number]["key"]) =>
    // Each sample's value holds until the next sample: horizontal first, then vertical.
    s.map((p, i) => (i === 0 ? `M${x(0)} ${y(p[key])}` : `H${x(i)} V${y(p[key])}`)).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (s.length - 1));
    setHover(i >= 0 && i < s.length ? i : null);
  };
  const p = hover !== null ? s[hover] : null;

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <div className="legend" aria-hidden>
        {SERIES.map((k) => (
          <span key={k.key}>
            <span className="key" style={{ background: k.color, ...(k.dash ? { backgroundImage: "none", opacity: 0.8 } : {}) }} />
            {k.label}
          </span>
        ))}
        <span><span className="key" style={{ background: "var(--critical)", opacity: 0.25, height: 10 }} />Deficit</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${hospital.hospital_name}: required versus available credentialed physicians over 90 minutes`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: maxY + 1 }, (_, v) => (
          <g key={v}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {s.slice(0, -1).map((pt, i) =>
          pt.deficit > 0 ? (
            <rect key={i} x={x(i)} width={x(i + 1) - x(i)} y={y(pt.required)} height={y(pt.available) - y(pt.required)}
              fill="var(--critical)" opacity={0.18} />
          ) : null,
        )}
        <line className="axis-line" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
        {s.map((pt, i) => (i % 3 === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{hhmm(pt.at)}</text> : null))}
        {SERIES.map((k) => (
          <path key={k.key} d={step(k.key)} fill="none" stroke={k.color} strokeWidth={2}
            strokeDasharray={k.dash || undefined} strokeLinejoin="round" />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--axis)" />}
        {p && SERIES.map((k) => (
          <circle key={k.key} cx={x(hover!)} cy={y(p[k.key])} r={4} fill={k.color} stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
      {p && (
        <div className="tooltip" style={{ left: `${Math.min(70, (x(hover!) / W) * 100)}%`, top: 30 }}>
          <div className="t-head">{hhmm(p.at)} ET</div>
          <div className="t-row"><span>Required</span><b className="num">{p.required}</b></div>
          <div className="t-row muted"><span>· block minimum</span><span className="num">{p.minimum}</span></div>
          <div className="t-row muted"><span>· surge uplift</span><span className="num">+{p.surge_uplift}</span></div>
          <div className="t-row"><span>Available</span><b className="num">{p.available}</b></div>
          <div className="t-row"><span>Roster ceiling</span><span className="num">{p.roster_ceiling}</span></div>
          <div className="t-row"><span>Deficit</span><b className="num">{p.deficit}</b></div>
          <div className="t-row muted"><span>Trailing demand vs p90</span><span className="num">{p.trailing_demand} / {p.p90}</span></div>
          {p.available_ids.length > 0 && <div className="muted">{p.available_ids.join(", ")}</div>}
          {p.planned_ids.length > 0 && <div>Planned: {p.planned_ids.join(", ")}</div>}
          {p.unverified_ids.length > 0 && <div>Unverified: {p.unverified_ids.join(", ")}</div>}
        </div>
      )}
      <details>
        <summary>Table view</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th className="num">Min</th><th className="num">Uplift</th><th className="num">Required</th>
              <th className="num">Available</th><th className="num">Ceiling</th><th className="num">Deficit</th><th>Available physicians</th></tr></thead>
            <tbody>
              {s.map((pt) => (
                <tr key={pt.at}><td>{hhmm(pt.at)}</td><td className="num">{pt.minimum}</td><td className="num">{pt.surge_uplift}</td>
                  <td className="num">{pt.required}</td><td className="num">{pt.available}</td><td className="num">{pt.roster_ceiling}</td>
                  <td className="num">{pt.deficit}</td><td className="small">{pt.available_ids.join(", ") || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const SEQ = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)"];

/** Hospitals × 19 samples, shaded by deficit (one blue hue, light→dark). */
export function CoverageHeatmap({ hospitals, onSelect, selected }: {
  hospitals: HospitalProjection[]; onSelect?: (id: string) => void; selected?: string;
}) {
  const [tip, setTip] = useState<{ h: HospitalProjection; i: number } | null>(null);
  const cols = hospitals[0]?.samples.length ?? 19;
  return (
    <div style={{ position: "relative" }}>
      <div className="legend">
        {[0, 1, 2, 3].map((v) => (
          <span key={v}><span className="key" style={{ background: SEQ[v], height: 10, border: "1px solid var(--border)" }} />{v === 3 ? "3+ short" : `${v} short`}</span>
        ))}
      </div>
      <div className="table-wrap">
        <div className="heat" style={{ gridTemplateColumns: `minmax(120px, 190px) repeat(${cols}, minmax(18px, 1fr)) 64px`, minWidth: 640 }}>
          <span />
          {hospitals[0]?.samples.map((p, i) => (
            <span key={i} className="muted" style={{ textAlign: "center", fontSize: 10 }}>{i % 3 === 0 ? hhmm(p.at) : ""}</span>
          ))}
          <span className="muted" style={{ textAlign: "right" }}>min</span>
          {hospitals.map((h) => (
            <Row key={h.hospital_id} h={h} onTip={setTip} onSelect={onSelect} selected={selected === h.hospital_id} />
          ))}
        </div>
      </div>
      {tip && (
        <div className="tooltip" style={{ right: 8, top: 0 }}>
          <div className="t-head">{tip.h.hospital_name} · {hhmm(tip.h.samples[tip.i].at)}</div>
          <div className="t-row"><span>Required</span><b>{tip.h.samples[tip.i].required}</b></div>
          <div className="t-row"><span>Available</span><b>{tip.h.samples[tip.i].available}</b></div>
          <div className="t-row"><span>Deficit</span><b>{tip.h.samples[tip.i].deficit}</b></div>
          {tip.h.samples[tip.i].surge_uplift > 0 && <div>Demand spike: +1 required</div>}
        </div>
      )}
    </div>
  );
}

function Row({ h, onTip, onSelect, selected }: {
  h: HospitalProjection; onTip: (t: { h: HospitalProjection; i: number } | null) => void;
  onSelect?: (id: string) => void; selected: boolean;
}) {
  return (
    <>
      <button className="label" onClick={() => onSelect?.(h.hospital_id)}
        style={{ border: 0, background: "none", textAlign: "left", cursor: onSelect ? "pointer" : "default", fontWeight: selected ? 700 : 400 }}
        title={h.hospital_name}>
        {h.spike_now ? "▲ " : ""}{h.hospital_name}
      </button>
      {h.samples.map((p, i) => (
        <span key={i} className="cell" style={{ background: SEQ[Math.min(3, p.deficit)], color: p.deficit >= 2 ? "#fff" : "var(--ink-2)" }}
          onMouseEnter={() => onTip({ h, i })} onMouseLeave={() => onTip(null)}
          aria-label={`${h.hospital_name} ${hhmm(p.at)}: ${p.deficit} short`}>
          {p.deficit > 0 ? p.deficit : ""}
        </span>
      ))}
      <span className="num" style={{ textAlign: "right", alignSelf: "center" }}>{h.deficit_minutes}</span>
    </>
  );
}
