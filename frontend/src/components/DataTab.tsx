import { useState } from "react";
import { ApiError, mutate } from "../api";
import { dateTime, hhmmss, wall } from "../format";
import type { ImportSummary, Report, User } from "../types";
import { useAction } from "./useAction";

const EXAMPLE = `event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description
EVT-90001,2026-03-17T18:21:00-04:00,2026-03-17T18:21:02-04:00,CON-9001,consult_received,,SYN-005,Stroke consult request received
EVT-90002,2026-03-17T18:22:00-04:00,2026-03-17T18:22:03-04:00,CON-9001,consult_triaged,,SYN-005,Consult triaged`;

function Summary({ s }: { s: ImportSummary }) {
  return (
    <div className="small">
      {s.header_errors?.length ? <div>Header: {s.header_errors.join("; ")}</div> : null}
      {s.rows_read !== undefined && (
        <div>
          {s.rows_read} rows read · <b>{s.accepted}</b> new · {s.duplicates} duplicate(s) skipped
          {s.error_count ? <> · <b>{s.error_count} invalid</b></> : null}
          {s.clock_advanced_to ? <> · clock advanced to {hhmmss(s.clock_advanced_to)} ET</> : null}
          {s.not_yet_visible ? <> · {s.not_yet_visible} not yet visible at the scenario clock</> : null}
        </div>
      )}
      {s.errors && s.errors.length > 0 && (
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
          {s.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row} {e.event_id}: {e.error}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function DataTab({ r, user, refresh }: { r: Report; user: User; refresh: () => Promise<void> }) {
  const act = useAction(refresh);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("pasted.csv");
  const [result, setResult] = useState<{ title: string; s: ImportSummary; ok: boolean } | null>(null);
  const isCoord = user.role === "coordinator";
  const v = r.verification;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFilename(f.name);
    setCsv(await f.text());
    setResult(null);
  };

  const doImport = async () => {
    setResult(null);
    try {
      const out = await mutate<ImportSummary>(`/api/v1/events/import?filename=${encodeURIComponent(filename)}`, undefined, { csv });
      setResult({ title: out.result.accepted ? "Imported. The report has updated without a restart." : "Nothing new: every row was already known.", s: out.result, ok: true });
    } catch (e) {
      const s = e instanceof ApiError ? (e.detail.summary as ImportSummary | undefined) : undefined;
      setResult({ title: e instanceof Error ? e.message : String(e), s: s ?? {}, ok: false });
    } finally {
      refresh();
    }
  };

  const advance = (minutes: number) =>
    act.run(`clock:${minutes}`, () => mutate<{ expired_offers: string[] }>("/api/v1/clock", { minutes }),
      (o) => `Clock advanced ${minutes} min.${o.result.expired_offers.length ? ` Expired: ${o.result.expired_offers.join(", ")}` : ""}`);
  const newRun = () =>
    act.run("run", () => mutate("/api/v1/runs", { label: "Fresh original fixture" }),
      () => "New run created from the original fixture. Previous runs and audit are kept.");

  return (
    <div className="grid two">
      <div className="stack">
        <section className="card">
          <div className="card-head"><h2>Import new events (live, no restart)</h2></div>
          {!isCoord && <div className="notice warn">Only the coordinator can import events.</div>}
          <p className="small muted" style={{ marginTop: 0 }}>
            Same columns as event_stream.csv. The whole batch is validated first; one bad row means nothing is imported.
            Re-importing the same rows changes nothing. The scenario clock moves forward to the latest ingested_at.
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <input type="file" accept=".csv,text/csv" aria-label="Choose CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn small" onClick={() => { setCsv(EXAMPLE); setFilename("example.csv"); }}>Load example</button>
          </div>
          <label htmlFor="csv">CSV content</label>
          <textarea id="csv" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paste CSV rows here" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!isCoord || !csv.trim()} onClick={doImport}>Validate and import</button>
            <span className="small muted">{csv ? `${csv.trim().split("\n").length - 1} data row(s)` : ""}</span>
          </div>
          {result && (
            <div className={`notice ${result.ok ? "ok" : "error"}`} style={{ marginTop: 10 }} role="status">
              <b>{result.title}</b>
              <Summary s={result.s} />
            </div>
          )}
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Import history (this run)</h2>
          {r.imports.length === 0 && <p className="muted small">Only the original fixture so far.</p>}
          {r.imports.map((i) => (
            <div key={i.import_id} className="audit-item">
              <b>{i.filename}</b> · {i.actor} · {wall(i.created_at)} · rev {i.revision}
              <Summary s={i.summary} />
            </div>
          ))}
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-head"><h2>Scenario clock</h2><span className="chip num">{dateTime(r.as_of)}</span></div>
          <p className="small muted" style={{ marginTop: 0 }}>
            Manual clock, independent of real time. Offer expiry and stage timers use it; audit also records wall time.
          </p>
          <div className="row">
            {[1, 5, 10, 15, 30].map((m) => (
              <button key={m} className="btn" disabled={act.busy !== null} onClick={() => advance(m)}>+{m} min</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={act.busy !== null} onClick={newRun}>Start new run (reset demo)</button>
            <span className="small muted">Keeps every previous run and its audit.</span>
          </div>
          {act.notice && <div className={`notice ${act.notice.kind}`} style={{ marginTop: 10 }} role="status">{act.notice.text}</div>}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Reference snapshot verification</h2>
            <span className={`badge ${v.passed ? "ok" : ""}`}>{v.matched}/{v.compared} fields</span>
          </div>
          <p style={{ marginTop: 0 }}>{v.passed ? "✓ " : ""}{v.label}</p>
          {!v.passed && !v.original_run && (
            <p className="small muted">New events were imported, so the 18:20 reference no longer describes this state. This is expected, not a failure. Start a new run to re-verify.</p>
          )}
          {v.mismatches.length > 0 && v.applicable && v.original_run && (
            <details><summary>{v.mismatches.length} mismatch(es)</summary>
              <ul className="small">{v.mismatches.slice(0, 30).map((m, i) => <li key={i}>{m.entity}.{m.field}: expected {m.expected}, got {String(m.actual)}</li>)}</ul>
            </details>
          )}
          <div className="small muted">
            {r.counts.events_applied} events applied · {r.counts.events_not_yet_visible} not yet visible · {r.counts.open_consults} open consults
          </div>
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Runs</h2>
          {r.runs.map((x) => (
            <div key={x.run_id} className="audit-item">
              <span className="mono">{x.run_id}</span> {x.is_current ? <span className="badge ok">current</span> : null} · {x.label} · rev {x.revision}
              {x.has_imports ? " · has imports" : ""}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
