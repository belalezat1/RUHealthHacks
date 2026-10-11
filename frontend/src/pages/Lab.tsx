import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Pill } from "../components/ui";
import { useOperations } from "../operations";
import { describeError, get, validateCsv } from "../backendClient";
import { ImportResults, type ImportOutcome } from "../components/ImportResults";
import type { Envelope, ImportSummary, Report } from "../backendTypes";
export default function Lab() {
  const { user, report, write, busy } = useOperations();
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("event_stream.csv");
  const [validation, setValidation] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [advance, setAdvance] = useState(true);
  function change(text: string) {
    setCsv(text);
    setValidation(null);
    setResult(null);
    setOutcome(null);
    setError("");
  }
  if (user.role === "physician")
    return (
      <div className="rx-page">
        <Card title="Data import">
          <p>Import is restricted to coordinators.</p>
          <Link to="/app">View your offers</Link>
        </Card>
      </div>
    );
  const disabled = busy || checking;
  const step = result ? 3 : validation?.ok ? 2 : csv.trim() ? 1 : 0;
  return (
    <div className="rx-page">
      {outcome && <ImportResults outcome={outcome} />}
      <Card title="Import official event CSV">
        <ol className="ops-import-steps" aria-label="CSV import steps">
          {["Choose CSV", "Validate", "Import", "Results"].map(
            (label, index) => (
              <li
                key={label}
                className={
                  index === step ? "is-current" : index < step ? "is-done" : ""
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? "✓" : index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
        <p>
          Upload recorded events in the challenge CSV format. Validation checks
          every row before the backend imports the batch.
        </p>
        <p className="ops-helper">
          Coverage and consult state refresh every five seconds. New events can
          advance scenario time; no events are generated.
        </p>
        <p className="real-header-format ops-import-schema">
          <code>
            event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description
          </code>
        </p>
        <label className="real-field ops-upload">
          Event CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={disabled}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                setFilename(file.name);
                change(text);
              } catch (e) {
                setError(describeError(e));
              }
            }}
          />
        </label>
        <label className="real-field">
          CSV contents
          <textarea
            rows={5}
            spellCheck={false}
            disabled={disabled}
            value={csv}
            onChange={(e) => change(e.target.value)}
            placeholder="Paste the official CSV header and recorded rows"
          />
        </label>
        <label className="real-field">
          <span>
            <input
              type="checkbox"
              checked={advance}
              disabled={disabled}
              onChange={(e) => setAdvance(e.target.checked)}
            />{" "}
            Advance scenario clock to the latest imported ingestion timestamp
          </span>
        </label>
        <p>
          This replays supplied records. It does not generate events or run the
          scenario in real time.
        </p>
        <div className="real-actions">
          <button
            className="rx-btn rx-btn-secondary"
            disabled={disabled || user.role !== "coordinator" || !csv.trim()}
            onClick={async () => {
              setChecking(true);
              setError("");
              setResult(null);
              try {
                const response = await validateCsv(csv);
                setValidation(response.data);
              } catch (e) {
                setValidation(null);
                setError(describeError(e));
              } finally {
                setChecking(false);
              }
            }}
          >
            Validate CSV
          </button>
          <button
            className="rx-btn rx-btn-primary"
            disabled={
              disabled || user.role !== "coordinator" || !validation?.ok
            }
            onClick={async () => {
              setError("");
              setOutcome(null);
              try {
                const before = await get<Envelope<Report>>("/api/v1/report");
                const response = await write<ImportSummary>(
                  `/api/v1/events/import?filename=${encodeURIComponent(filename)}&advance_clock=${advance}`,
                  undefined,
                  csv,
                );
                setResult(response);
                setValidation(null);
                try {
                  const after = await get<Envelope<Report>>("/api/v1/report");
                  if (before.run_id === after.run_id)
                    setOutcome({
                      filename,
                      summary: response,
                      before: before.data,
                      after: after.data,
                    });
                  else
                    setError(
                      "Import succeeded, but the active run changed. Review the current report before comparing results.",
                    );
                } catch {
                  setError(
                    "Import succeeded. The results comparison could not load; refresh the coverage desk to inspect current state.",
                  );
                }
              } catch (e) {
                setError(describeError(e));
                setValidation(null);
              }
            }}
          >
            Import validated CSV
          </button>
          <Link className="rx-btn rx-btn-secondary" to="/app">
            Return to coverage desk
          </Link>
        </div>
        {user.role !== "coordinator" && (
          <p>Only a coordinator can import records.</p>
        )}
        {error && (
          <p role="alert" className="real-error">
            {error}
          </p>
        )}
        {validation && <Summary title="Validation result" value={validation} />}
        {result && <Summary title="Import complete" value={result} />}
      </Card>
      <Card title="Source files & verification">
        <p>
          Reference rosters, credentials, hospital baselines, and snapshots are
          loaded from <code>data/original</code>. Upload event records above.
        </p>
        {report ? (
          <>
            <p>
              {report.verification.label} ·{" "}
              {report.verification.applicable
                ? `${report.verification.matched}/${report.verification.compared} snapshot fields match`
                : "Reference comparison is only applicable at the official snapshot time."}
            </p>
            <div className="real-table-wrap">
              <table className="real-table">
                <thead>
                  <tr>
                    <th>Source file</th>
                    <th>SHA-256</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.evidence.source_hashes).map(
                    ([name, hash]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          <code>{hash}</code>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Loading source evidence…</p>
        )}
      </Card>
      <Card title="Import history">
        {report?.imports.length === 0 && <p>No imports in the current run.</p>}
        {report?.imports.map((i) => (
          <article className="real-row" key={i.import_id}>
            <strong>{i.filename}</strong>
            <p>
              {i.created_at} · {i.actor} · Revision {i.revision}
            </p>
            <p>
              {i.summary.accepted ?? 0} accepted · {i.summary.duplicates ?? 0}{" "}
              duplicates
            </p>
          </article>
        ))}
      </Card>
      <Card
        title="Audit trail"
        actions={
          <a className="rx-btn rx-btn-secondary" href="/api/v1/audit.csv">
            Download audit CSV
          </a>
        }
      >
        {report?.audit_tail.map((a) => (
          <article className="real-row" key={a.seq}>
            <strong>{a.kind.replaceAll("_", " ")}</strong>
            <p>
              {a.scenario_time} · {a.actor} · {a.entity}
            </p>
          </article>
        ))}
      </Card>
    </div>
  );
}
function Summary({ title, value }: { title: string; value: ImportSummary }) {
  return (
    <section className="real-row" aria-live="polite">
      <h3>{title}</h3>
      <div className="real-actions">
        <Pill tone={value.ok ? "ok" : "critical"}>
          {value.ok ? "Valid" : "Rejected"}
        </Pill>
        <Pill>{value.rows_read ?? 0} rows read</Pill>
        <Pill>{value.accepted ?? 0} accepted</Pill>
        <Pill>{value.duplicates ?? 0} duplicates</Pill>
        <Pill>{value.error_count ?? 0} errors</Pill>
      </div>
      {value.clock_advanced_to && (
        <p>Scenario clock: {value.clock_advanced_to}</p>
      )}
      {value.header_errors?.map((e, i) => (
        <p key={i}>{e}</p>
      ))}
      {value.errors?.map((e, i) => (
        <p key={i}>
          Row {e.row}
          {e.event_id ? ` (${e.event_id})` : ""}: {e.error}
        </p>
      ))}
    </section>
  );
}
