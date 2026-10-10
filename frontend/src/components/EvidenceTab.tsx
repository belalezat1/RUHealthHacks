import type { Report } from "../types";

export default function EvidenceTab({ r, fetchMs }: { r: Report; fetchMs: number | null }) {
  const e = r.evidence;
  return (
    <div className="grid two">
      <div className="stack">
        <section className="card">
          <div className="card-head"><h2>Measured on this request</h2></div>
          <div className="metrics">
            <div className="metric">
              <div className="label">Engine compute</div>
              <div className="value num">{r.engine_timing_ms.total.toFixed(1)} ms</div>
              <div className="sub">replay {r.engine_timing_ms.replay.toFixed(1)} + analysis {r.engine_timing_ms.analysis.toFixed(1)}</div>
            </div>
            <div className="metric">
              <div className="label">Last report fetch (browser)</div>
              <div className="value num">{fetchMs ?? "—"} ms</div>
              <div className="sub">HTTP round trip incl. network</div>
            </div>
            <div className="metric">
              <div className="label">Projection cache</div>
              <div className="value" style={{ fontSize: 17 }}>{e.projection_cache_hit ? "hit" : "recomputed"}</div>
              <div className="sub">keyed by run + revision</div>
            </div>
          </div>
          <p className="small muted">
            Single measurements, not a distribution. Benchmark distributions come from <code>scripts/bench.py</code> and{" "}
            <code>scripts/loadtest.py</code> on the final build, with hardware and sample size recorded.
          </p>
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Release</h2>
          <table>
            <tbody>
              <tr><td>Release SHA</td><td className="mono">{e.release_sha}</td></tr>
              <tr><td>Schema version</td><td>{e.schema_version}</td></tr>
              <tr><td>Run</td><td className="mono">{r.run.run_id} · rev {r.run.revision}</td></tr>
              <tr><td>Finance</td><td>{e.finance.configured ? "configured" : "not configured"} — {e.finance.note}</td></tr>
              {Object.entries(e.partners).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Source data integrity (SHA-256)</h2>
          <table>
            <tbody>
              {Object.entries(e.source_hashes).map(([f, h]) => (
                <tr key={f}><td>{f}</td><td className="mono small">{h.slice(0, 16)}…</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Model assumptions</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Measured results, modeled outcomes and input assumptions are kept separate. Coverage deficits are modeled; no patient-wait
          reduction, availability certainty or financial gain is claimed.
        </p>
        <ul>{r.assumptions.map((a) => <li key={a} style={{ marginBottom: 6 }}>{a}</li>)}</ul>
      </section>
    </div>
  );
}
